// Shared machinery for the scripts that read facts out of a repo's prose
// and run a command per fact: a proof reader (one-off claims with a
// `<!-- proof: … -->`) and live-values.mjs (named values with
// `<!-- live:NAME -->`). There is one scope, one runner, one local gate and
// one notion of "inside a generated block", so the two readers cannot
// disagree about which files are docs or which lines are generated.
//
//   collectFiles(root)             the prose in scope (INDEX.md never is)
//   liveScope(root)                collectFiles plus any repo's agent-facing docs
//   autogenMask(lines)             true for each line inside an AUTO-GEN block
//   checkLocal(run, root)          the proof reader's --local gate (first word only)
//   checkQuerySegments(run, tools) every command in a pipeline/list allowlisted
//   runCommand(run, opts)          bash -c in root, with a timeout
//
// autogenMask is anchored: a marker is a WHOLE line, `<!-- AUTO-GEN:start NAME -->`
// or `<!-- AUTO-GEN:end NAME -->`, and an end closes only the block of the same
// NAME. The loose prefix regex it replaces treated a table cell that QUOTES both
// markers as the block's end, so everything after it read as hand-written, and
// a claim placed there reported `ok` when it should be MISPLACED.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { commandWord, shellWords, splitSegments } from "./shell-command.mjs";

// live-values' scope, portable to any repo it is copied into:
// collectFiles plus the agent-facing docs of a project repo - root CLAUDE.md,
// AGENTS.md and README.md, docs/**/*.md at any depth, and skills/*/SKILL.md or
// .claude/skills/*/SKILL.md - never INDEX.md, and in a git checkout only
// TRACKED files, so the hook judges exactly what CI will. Untracked scratch
// docs are not the repo's prose, and git lists a symlink as a link, so a
// skills symlink into a dependency directory is never followed. Outside a git
// checkout it is collectFiles alone.
const PROJECT_DOC_RE = /^(?:(?:CLAUDE|AGENTS|README)\.md|docs\/.+\.md|(?:\.claude\/)?skills\/[^/]+\/SKILL\.md)$/;
export const liveScope = (root) => {
  const base = collectFiles(root);
  let tracked;
  try {
    tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).split("\0");
  } catch {
    return base;
  }
  const inBase = new Set(base.map((abs) => relative(root, abs)));
  const out = [];
  for (const p of tracked) {
    if (!p || /(^|\/)INDEX\.md$/.test(p) || !(inBase.has(p) || PROJECT_DOC_RE.test(p))) continue;
    const abs = join(root, p);
    if (existsSync(abs) && !lstatSync(abs).isSymbolicLink()) out.push(abs);
  }
  return out.sort();
};

// The local lane of a proof-annotation reader: tools that need no network, auth or machine path.
export const LOCAL_TOOLS = new Set(["ls", "test", "grep", "node", "jq", "git", "cat", "wc"]);

// Files in scope: the always-read entry docs plus the docs directory and
// skills that carry factual claims. INDEX.md is generated, so it is never in
// scope. AGENTS.md and CLAUDE.md are both listed; a repo keeps whichever
// entry doc it uses (the other name simply matches nothing). The four
// *-ORGANIZATION.md names come from the setup this engine was extracted from;
// a repo without them loses nothing.
export const collectFiles = (root) => {
  const files = [];
  for (const name of ["AGENTS.md", "CLAUDE.md", "MCP-ORGANIZATION.md", "HOOKS-ORGANIZATION.md", "SKILLS-ORGANIZATION.md", "SCRIPTS-ORGANIZATION.md"]) {
    if (existsSync(join(root, name))) files.push(join(root, name));
  }
  const docs = join(root, "docs");
  if (existsSync(docs)) {
    for (const e of readdirSync(docs, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md")) files.push(join(docs, e.name));
    }
  }
  const skills = join(root, "skills");
  if (existsSync(skills)) {
    for (const e of readdirSync(skills, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sk = join(skills, e.name, "SKILL.md");
      if (existsSync(sk)) files.push(sk);
      const refs = join(skills, e.name, "references");
      if (existsSync(refs)) {
        for (const r of readdirSync(refs, { withFileTypes: true })) {
          if (r.isFile() && r.name.endsWith(".md")) files.push(join(refs, r.name));
        }
      }
    }
  }
  return files.sort();
};

const AUTOGEN_START = /^\s*<!--\s*AUTO-GEN:start\s+(\S+)\s*-->\s*$/;
const AUTOGEN_END = /^\s*<!--\s*AUTO-GEN:end\s+(\S+)\s*-->\s*$/;

// One boolean per line: true from a start marker through its matching end
// marker, both inclusive. An end with another NAME, or with no open block, is
// ordinary text. A start with no end runs to the end of the file: an
// unterminated block is still generated output, and reading it as hand-written
// is the failure this exists to prevent.
export const autogenMask = (lines) => {
  const mask = new Array(lines.length).fill(false);
  let open = null;
  lines.forEach((line, i) => {
    if (open === null) {
      const s = line.match(AUTOGEN_START);
      if (s) open = s[1];
    }
    mask[i] = open !== null;
    if (open !== null) {
      const e = line.match(AUTOGEN_END);
      if (e && e[1] === open) open = null;
    }
  });
  return mask;
};

const expandPath = (tok) => (tok.startsWith("~") ? join(homedir(), tok.slice(1)) : tok);

// The proof-annotation reader's `--local` gate: first word must be allowlisted and every
// path-like argument must exist. Relative path-likes resolve against the repo
// root, which is also the commands' cwd. It reads the FIRST word only, so a
// later pipeline segment is not gated; checkQuerySegments is the strict form.
export const checkLocal = (run, root) => {
  const tokens = run.trim().split(/\s+/).filter((t) => t && t !== "|");
  const first = (tokens[0] ?? "").replace(/^[`'"]+|[`'";]+$/g, "");
  if (!LOCAL_TOOLS.has(first)) return { ok: false, reason: "tool not local" };
  for (const raw of tokens.slice(1)) {
    const tok = raw.replace(/^[`'"]+|[`'",;]+$/g, "");
    if (/^(\/|~|\.\/)/.test(tok)) {
      const abs = tok.startsWith("/") || tok.startsWith("~") ? expandPath(tok) : resolve(root, tok);
      if (!existsSync(abs)) return { ok: false, reason: "path absent" };
    }
  }
  return { ok: true };
};

// Keywords that open or close a compound command. `for`/`case` segments carry
// a word list, not a command; the closers carry nothing. `if`/`while`/`until`/
// `elif` are followed by the command they test, which is gated like any other.
const LIST_KEYWORDS = new Set(["for", "case", "select"]);
const CLOSERS = new Set(["done", "fi", "esac", "}", ")"]);
const TESTERS = new Set(["if", "while", "until", "elif", "!"]);

// Bodies of `$(…)` and backtick substitutions outside single quotes. A command
// substitution runs a command even inside double quotes, so it is gated too.
const substitutions = (run) => {
  const text = run.replace(/'[^']*'/g, " ");
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && text[i + 1] === "(" && text[i + 2] !== "(") {
      let depth = 0;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")" && --depth === 0) { out.push(text.slice(i + 2, j)); i = j; break; }
      }
    } else if (text[i] === "`") {
      const j = text.indexOf("`", i + 1);
      if (j > i) { out.push(text.slice(i + 1, j)); i = j; }
    }
  }
  return out;
};

// Every command in `run` (each pipeline stage, each `;`/`&&`/`||` segment and
// each command substitution) must be in `tools`. This is the gate a
// `kind: file` live value needs, since it must run on a CI runner with no
// auth. A first-word-only gate would pass a disallowed command hidden behind
// a pipe, so every segment is gated.
export const checkQuerySegments = (run, tools = LOCAL_TOOLS) => {
  for (const inner of substitutions(run)) {
    const r = checkQuerySegments(inner, tools);
    if (!r.ok) return r;
  }
  for (const seg of splitSegments(run)) {
    let words = shellWords(seg);
    let word = commandWord(words);
    while (TESTERS.has(word)) {
      words = words.slice(words.indexOf(word) + 1);
      word = commandWord(words);
    }
    if (!word || LIST_KEYWORDS.has(word) || CLOSERS.has(word)) continue;
    if (!tools.has(word)) return { ok: false, reason: `command not allowed: ${word}`, word };
  }
  return { ok: true };
};

export const clip200 = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

// Run one command with bash -c in `root`. Never throws: a non-zero exit, a
// timeout or a spawn error comes back as { ok: false, timedOut, output }, where
// output is the text a report prints (clipped stdout + the error), never empty.
export const runCommand = (run, { root, timeoutMs }) => {
  try {
    const stdout = execFileSync("bash", ["-c", run], {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout };
  } catch (err) {
    const out = clip200((err.stdout ?? "") + " " + (err.message ?? ""));
    const timedOut = /ETIMEDOUT|timed out/i.test(String(err.message ?? ""));
    return {
      ok: false,
      timedOut,
      output: timedOut ? `timed out after ${timeoutMs} ms ${out}`.trim() : (out || "exit without output"),
    };
  }
};

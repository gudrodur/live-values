#!/usr/bin/env node
// GENERATED from https://github.com/gudrodur/live-values (engine/, by build.mjs).
// Do not edit this copy: change the source there, rebuild with `node build.mjs`, and copy dist/ again.
// Every adopting repo carries it byte-identical at scripts/live-values.mjs;
// a copy-identity check keeps it so. Usage and the marker grammar: node scripts/live-values.mjs --help.

// engine/live-values.mjs
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync2, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join as join2, relative as relative2 } from "node:path";

// engine/lib/cli-entry.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!metaUrl || !argv1)
    return false;
  let self;
  let invoked;
  try {
    self = fs.realpathSync(fileURLToPath(metaUrl));
    invoked = fs.realpathSync(argv1);
  } catch {
    return false;
  }
  return self === invoked;
}

// engine/lib/config-root.mjs
import path from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var ROOT_ENV_VARS = ["LIVE_VALUES_ROOT", "CLAUDE_CONFIG_ROOT", "AGENT_CONFIG_HOME"];
var envRoot = () => {
  for (const key of ROOT_ENV_VARS) {
    const v = process.env[key];
    if (v != null && v !== "")
      return v;
  }
  return null;
};
var repoRootOf = (metaUrl) => path.resolve(path.dirname(fileURLToPath2(metaUrl)), "..");
var resolveRoot = (metaUrl) => envRoot() ?? repoRootOf(metaUrl ?? import.meta.url);

// engine/lib/doc-scope.mjs
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// engine/lib/shell-command.mjs
var stripQuoted = (text) => String(text ?? "").replace(/(?<=[=\s([{;&|<>$`'"]|^)'(?:[^'\\]|\\.)*'|(?<=[=\s([{;&|<>$`'"]|^)"(?:[^"\\]|\\.)*"/gs, " ");
var QUOTE_OPEN_PRECEDER = /[=\s([{;&|<>$`'"]/;
var splitSegments = (command) => splitSegmentsDetailed(command).map((s) => s.text);
var splitSegmentsDetailed = (command) => {
  const text = String(command ?? "");
  const segs = [];
  let cur = "";
  let sep = "";
  const push = (next) => {
    segs.push({ text: cur, sep });
    cur = "";
    sep = next;
  };
  const findClose = (q, from) => {
    for (let j = from;j < text.length; j++) {
      const c = text[j];
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === q)
        return j;
    }
    return -1;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if ((c === "'" || c === '"') && (i === 0 || QUOTE_OPEN_PRECEDER.test(text[i - 1]))) {
      const close = findClose(c, i + 1);
      if (close < 0) {
        cur += c;
        i++;
        continue;
      }
      cur += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (c === "\\" && i + 1 < text.length) {
      cur += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if ((c === "&" || c === "|") && text[i + 1] === c) {
      push(c + c);
      i += 2;
      continue;
    }
    if (c === "&" && (text[i - 1] === ">" || text[i + 1] === ">")) {
      cur += c;
      i++;
      continue;
    }
    if (c === ";" || c === `
` || c === "|" || c === "&") {
      push(c);
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  push("");
  return segs;
};
var shellWords = (segment) => {
  const text = String(segment ?? "");
  const words = [];
  let cur = null;
  let i = 0;
  const add = (s) => {
    cur = (cur ?? "") + s;
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (cur !== null)
        words.push(cur);
      cur = null;
      i++;
      continue;
    }
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      const end = close < 0 ? text.length : close;
      add(text.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && /["\\$`]/.test(text[j + 1] ?? "")) {
          s += text[j + 1];
          j += 2;
          continue;
        }
        s += text[j];
        j++;
      }
      add(s);
      i = j + 1;
      continue;
    }
    if (c === "\\" && i + 1 < text.length) {
      add(text[i + 1]);
      i += 2;
      continue;
    }
    add(c);
    i++;
  }
  if (cur !== null)
    words.push(cur);
  return words;
};
var PREFIX_WORDS = new Set(["sudo", "command", "exec", "nohup", "time", "then", "do", "else", "!", "{", "("]);
var ASSIGNMENT_RE = /^[A-Za-z_]\w*=/;
var commandStart = (words) => {
  const env = {};
  let i = 0;
  while (i < words.length) {
    const w = words[i].replace(/^[({]+/, "");
    if (w === "") {
      i++;
      continue;
    }
    if (ASSIGNMENT_RE.test(w)) {
      const eq = w.indexOf("=");
      env[w.slice(0, eq)] = w.slice(eq + 1);
      i++;
      continue;
    }
    if (w === "env" || PREFIX_WORDS.has(w)) {
      i++;
      continue;
    }
    if (w === "timeout") {
      i++;
      while (i < words.length && /^(-\S+|\d+(\.\d+)?[smhd]?)$/.test(words[i]))
        i++;
      continue;
    }
    return { index: i, env };
  }
  return { index: -1, env };
};
var commandWord = (words) => {
  const { index } = commandStart(words);
  return index < 0 ? "" : words[index].replace(/^[({]+/, "");
};

// engine/lib/doc-scope.mjs
var PROJECT_DOC_RE = /^(?:(?:CLAUDE|AGENTS|README)\.md|docs\/.+\.md|(?:\.claude\/)?skills\/[^/]+\/SKILL\.md)$/;
var liveScope = (root) => {
  const base = collectFiles(root);
  let tracked;
  try {
    tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).split("\x00");
  } catch {
    return base;
  }
  const inBase = new Set(base.map((abs) => relative(root, abs)));
  const out = [];
  for (const p of tracked) {
    if (!p || /(^|\/)INDEX\.md$/.test(p) || !(inBase.has(p) || PROJECT_DOC_RE.test(p)))
      continue;
    const abs = join(root, p);
    if (existsSync(abs) && !lstatSync(abs).isSymbolicLink())
      out.push(abs);
  }
  return out.sort();
};
var LOCAL_TOOLS = new Set(["ls", "test", "grep", "node", "jq", "git", "cat", "wc"]);
var collectFiles = (root) => {
  const files = [];
  for (const name of ["AGENTS.md", "CLAUDE.md", "MCP-ORGANIZATION.md", "HOOKS-ORGANIZATION.md", "SKILLS-ORGANIZATION.md", "SCRIPTS-ORGANIZATION.md"]) {
    if (existsSync(join(root, name)))
      files.push(join(root, name));
  }
  const docs = join(root, "docs");
  if (existsSync(docs)) {
    for (const e of readdirSync(docs, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md"))
        files.push(join(docs, e.name));
    }
  }
  const skills = join(root, "skills");
  if (existsSync(skills)) {
    for (const e of readdirSync(skills, { withFileTypes: true })) {
      if (!e.isDirectory())
        continue;
      const sk = join(skills, e.name, "SKILL.md");
      if (existsSync(sk))
        files.push(sk);
      const refs = join(skills, e.name, "references");
      if (existsSync(refs)) {
        for (const r of readdirSync(refs, { withFileTypes: true })) {
          if (r.isFile() && r.name.endsWith(".md"))
            files.push(join(refs, r.name));
        }
      }
    }
  }
  return files.sort();
};
var AUTOGEN_START = /^\s*<!--\s*AUTO-GEN:start\s+(\S+)\s*-->\s*$/;
var AUTOGEN_END = /^\s*<!--\s*AUTO-GEN:end\s+(\S+)\s*-->\s*$/;
var autogenMask = (lines) => {
  const mask = new Array(lines.length).fill(false);
  let open = null;
  lines.forEach((line, i) => {
    if (open === null) {
      const s = line.match(AUTOGEN_START);
      if (s)
        open = s[1];
    }
    mask[i] = open !== null;
    if (open !== null) {
      const e = line.match(AUTOGEN_END);
      if (e && e[1] === open)
        open = null;
    }
  });
  return mask;
};
var LIST_KEYWORDS = new Set(["for", "case", "select"]);
var CLOSERS = new Set(["done", "fi", "esac", "}", ")"]);
var TESTERS = new Set(["if", "while", "until", "elif", "!"]);
var substitutions = (run) => {
  const text = run.replace(/'[^']*'/g, " ");
  const out = [];
  for (let i = 0;i < text.length; i++) {
    if (text[i] === "$" && text[i + 1] === "(" && text[i + 2] !== "(") {
      let depth = 0;
      for (let j = i + 1;j < text.length; j++) {
        if (text[j] === "(")
          depth++;
        else if (text[j] === ")" && --depth === 0) {
          out.push(text.slice(i + 2, j));
          i = j;
          break;
        }
      }
    } else if (text[i] === "`") {
      const j = text.indexOf("`", i + 1);
      if (j > i) {
        out.push(text.slice(i + 1, j));
        i = j;
      }
    }
  }
  return out;
};
var checkQuerySegments = (run, tools = LOCAL_TOOLS) => {
  for (const inner of substitutions(run)) {
    const r = checkQuerySegments(inner, tools);
    if (!r.ok)
      return r;
  }
  for (const seg of splitSegments(run)) {
    let words = shellWords(seg);
    let word = commandWord(words);
    while (TESTERS.has(word)) {
      words = words.slice(words.indexOf(word) + 1);
      word = commandWord(words);
    }
    if (!word || LIST_KEYWORDS.has(word) || CLOSERS.has(word))
      continue;
    if (!tools.has(word))
      return { ok: false, reason: `command not allowed: ${word}`, word };
  }
  return { ok: true };
};
var clip200 = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
var runCommand = (run, { root, timeoutMs }) => {
  try {
    const stdout = execFileSync("bash", ["-c", run], {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, stdout };
  } catch (err) {
    const out = clip200((err.stdout ?? "") + " " + (err.message ?? ""));
    const timedOut = /ETIMEDOUT|timed out/i.test(String(err.message ?? ""));
    return {
      ok: false,
      timedOut,
      output: timedOut ? `timed out after ${timeoutMs} ms ${out}`.trim() : out || "exit without output"
    };
  }
};

// engine/live-values.mjs
var REGISTRY_FILE = "live-values.json";
var STORE_ENV = "LIVE_VALUES_STORE";
var rootOf = (metaUrl) => resolveRoot(metaUrl ?? import.meta.url);
var storePath = (root) => process.env[STORE_ENV] || join2(root, "data", "live-snapshots.json");
var SNAP_SPAN_RE = /^(.*) \(measured (\d{4}-\d{2}-\d{2})\)$/su;
var dated = (value, iso) => `${value} (measured ${iso.slice(0, 10)})`;
var DAY_MS = 86400000;
var FILE_TOOLS = new Set([
  ...LOCAL_TOOLS,
  "find",
  "awk",
  "sed",
  "python3",
  "sort",
  "uniq",
  "cut",
  "tr",
  "head",
  "tail",
  "paste",
  "printf",
  "echo"
]);
var HISTORY_GIT = new Set(["log", "rev-list", "shortlog", "describe", "blame", "reflog"]);
var FORMATS = new Set(["int", "word", "text"]);
var NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
var WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ");
var MARKER_RE = /<!-- live:([a-z0-9][a-z0-9-]*) -->((?:(?!<!--)[^\n])*?)<!-- \/live -->/g;
var OPENER_RE = /<!--\s*live:/g;
var CLOSER_RE = /<!--\s*\/live\s*-->/g;
var LINE_START_RE = /^(?:\s*(?:[-*+]\s|\d+[.)]\s|>))*\s*$/;
var validateRegistry = (raw) => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { error: `${REGISTRY_FILE} is not JSON: ${err.message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { error: `${REGISTRY_FILE} must be an object of NAME → entry` };
  const problems = [];
  for (const [name, e] of Object.entries(data)) {
    if (!NAME_RE.test(name))
      problems.push(`${name}: name must match ${NAME_RE}`);
    if (!e || typeof e !== "object") {
      problems.push(`${name}: entry must be an object`);
      continue;
    }
    const want = e.kind === "snapshot" ? ["format", "kind", "maxAgeDays", "run"] : ["format", "kind", "run"];
    const keys = Object.keys(e).sort();
    if (keys.join() !== want.join())
      problems.push(`${name}: keys must be exactly {${want.join(", ")}}, got {${keys.join(", ")}}`);
    if (e.kind !== "file" && e.kind !== "snapshot")
      problems.push(`${name}: kind must be "file" or "snapshot"`);
    if (!FORMATS.has(e.format))
      problems.push(`${name}: format must be one of ${[...FORMATS].join(", ")}`);
    if (typeof e.run !== "string" || !e.run.trim())
      problems.push(`${name}: run must be a non-empty string`);
    if (e.kind === "snapshot" && !(Number.isInteger(e.maxAgeDays) && e.maxAgeDays > 0))
      problems.push(`${name}: maxAgeDays must be a positive integer`);
    if (e.kind === "file" && typeof e.run === "string") {
      const gate = checkFileQuery(e.run);
      if (!gate.ok)
        problems.push(`${name}: kind "file" query ${gate.reason}`);
    }
  }
  return problems.length ? { error: problems.join(`
`) } : { entries: data };
};
var checkFileQuery = (run) => {
  const seg = checkQuerySegments(run, FILE_TOOLS);
  if (!seg.ok)
    return { ok: false, reason: seg.reason };
  for (const s of splitSegments(run)) {
    const bare = stripQuoted(s).split(/\s+/).filter(Boolean);
    const abs = bare.find((w) => /^(\/|~|\$HOME)/.test(w));
    if (abs)
      return { ok: false, reason: `names a machine path: ${abs}` };
    const words = shellWords(s);
    const word = commandWord(words);
    if (word === "git") {
      const sub = words.slice(words.indexOf("git") + 1).find((w, i, a) => !w.startsWith("-") && a[i - 1] !== "-C");
      if (HISTORY_GIT.has(sub))
        return { ok: false, reason: `reads git history (git ${sub}); CI clones at depth 1` };
    }
    if (word === "find" && words.some((w) => /^-(exec|execdir|ok|okdir)$/.test(w))) {
      return { ok: false, reason: "uses find -exec, which runs a command the gate cannot see" };
    }
  }
  return { ok: true };
};
var maskCodeSpans = (line) => line.replace(/(`+)[^`]*?\1/g, (m) => " ".repeat(m.length));
var scanFile = (content, file) => {
  const lines = content.split(`
`);
  const inBlock = autogenMask(lines);
  const found = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (fence === null)
        fence = f[1][0];
      else if (f[1][0] === fence)
        fence = null;
      return;
    }
    if (fence !== null)
      return;
    const text = maskCodeSpans(line);
    const at = { file, line: i + 1 };
    const spans = [...text.matchAll(MARKER_RE)];
    const openers = [...text.matchAll(OPENER_RE)].length;
    const closers = [...text.matchAll(CLOSER_RE)].length;
    if (openers !== spans.length || closers !== spans.length) {
      found.push({ ...at, result: "MALFORMED", detail: "a live opener or closer with no partner on this line (markers never span lines)" });
    }
    const proofAt = text.indexOf("<!-- proof:");
    for (const m of spans) {
      const row = { ...at, name: m[1], value: m[2], start: m.index, end: m.index + m[0].length };
      if (inBlock[i])
        Object.assign(row, { result: "MISPLACED", detail: "inside an AUTO-GEN block; the generator owns this line" });
      else if (LINE_START_RE.test(text.slice(0, m.index)))
        Object.assign(row, { result: "MALFORMED", detail: "first token of the line: GitHub renders the rest of the line as raw HTML; put a word before it" });
      else if (proofAt !== -1 && proofAt < m.index)
        Object.assign(row, { result: "MALFORMED", detail: "after a proof comment on the same line: proof-sweep would read it as bad JSON; put it before the proof" });
      found.push(row);
    }
  });
  return found;
};
var render = (raw, format, current) => {
  const v = raw.replace(/\s+$/u, "");
  if (format === "int")
    return /^\d+$/.test(v) ? { value: v } : { error: `not an int: ${JSON.stringify(v.slice(0, 60))}` };
  if (format === "word") {
    if (!/^\d+$/.test(v) || Number(v) >= WORDS.length)
      return { error: `not an int 0–${WORDS.length - 1}: ${JSON.stringify(v.slice(0, 60))}` };
    const w = WORDS[Number(v)];
    return { value: /^[A-Z]/.test(current ?? "") ? w[0].toUpperCase() + w.slice(1) : w };
  }
  if (!v || v.includes(`
`) || v.includes("<!--"))
    return { error: `text value must be one non-empty line with no comment: ${JSON.stringify(v.slice(0, 60))}` };
  return { value: v };
};
var resolveFileValues = (names, entries, { root, timeoutMs }) => {
  const out = new Map;
  for (const name of names) {
    const r = runCommand(entries[name].run, { root, timeoutMs });
    out.set(name, r.ok ? { raw: r.stdout } : { error: `query failed: ${r.output}`, code: 3 });
  }
  return out;
};
var loadStore = (root) => {
  const p = storePath(root);
  if (!existsSync2(p))
    return { entries: null };
  try {
    return { entries: JSON.parse(readFileSync(p, "utf8")) };
  } catch (err) {
    return { error: `${p} is not JSON: ${err.message}` };
  }
};
var judgeSnapshot = (r, e, store, now) => {
  const m = r.value.match(SNAP_SPAN_RE);
  const s = store.entries?.[r.name];
  const valid = s && typeof s.value === "string" && !Number.isNaN(Date.parse(s.measuredAt));
  if (valid) {
    const storeAge = (now - Date.parse(s.measuredAt)) / DAY_MS;
    if (storeAge > e.maxAgeDays) {
      return { result: "STALE", code: 1, detail: `store value is ${storeAge.toFixed(1)} days old, maxAgeDays ${e.maxAgeDays}: the scheduled --snapshot run is behind` };
    }
    const shown = render(s.value, e.format, m ? m[1] : r.value);
    if (shown.error)
      return { result: "QUERY_FAILED", code: 3, detail: shown.error };
    const expected = dated(shown.value, s.measuredAt);
    if (!m || m[1] !== shown.value)
      return { result: "DRIFT", expected };
    const spanAge2 = (now - Date.parse(`${m[2]}T00:00:00Z`)) / DAY_MS;
    const newer = s.measuredAt.slice(0, 10) > m[2];
    if (newer && spanAge2 >= e.maxAgeDays / 2)
      return { result: "DRIFT", expected };
    return { result: "OK", expected: r.value };
  }
  if (!m) {
    return { result: "MALFORMED", detail: `a snapshot span carries its date, "VALUE (measured YYYY-MM-DD)"; measure it (--snapshot) and --write where the store exists` };
  }
  const spanAge = (now - Date.parse(`${m[2]}T00:00:00Z`)) / DAY_MS;
  if (spanAge > e.maxAgeDays) {
    return { result: "STALE", code: 1, detail: `measured ${m[2]}, ${Math.floor(spanAge)} days ago, maxAgeDays ${e.maxAgeDays}: run --write where the snapshot store is current, and commit` };
  }
  return { result: "OK", expected: r.value };
};
var runSnapshots = ({ root, timeoutMs = 60000, now = Date.now() }) => {
  const regPath = join2(root, REGISTRY_FILE);
  if (!existsSync2(regPath))
    return { fatal: `no ${REGISTRY_FILE} at ${root}`, code: 2 };
  const reg = validateRegistry(readFileSync(regPath, "utf8"));
  if (reg.error)
    return { fatal: reg.error, code: 2 };
  const names = Object.entries(reg.entries).filter(([, e]) => e.kind === "snapshot").map(([n]) => n);
  const file = storePath(root);
  let store = {};
  if (existsSync2(file)) {
    try {
      store = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      return { fatal: `${file} is not JSON: ${err.message}`, code: 2 };
    }
  }
  const at = new Date(now).toISOString();
  const report = { measured: [], kept: [], failed: [], missing: [] };
  for (const name of names) {
    const e = reg.entries[name];
    const r = runCommand(e.run, { root, timeoutMs });
    if (!r.ok) {
      if (store[name]?.value) {
        report.kept.push(name);
        report.failed.push({ name, error: r.output });
      } else {
        report.missing.push(name);
        report.failed.push({ name, error: r.output });
      }
      continue;
    }
    const shown = render(r.stdout, e.format, "");
    if (shown.error) {
      if (store[name]?.value) {
        report.kept.push(name);
        report.failed.push({ name, error: shown.error });
      } else {
        report.missing.push(name);
        report.failed.push({ name, error: shown.error });
      }
      continue;
    }
    store[name] = { value: r.stdout.replace(/\s+$/u, ""), measuredAt: at };
    report.measured.push(name);
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.live-values.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + `
`);
  renameSync(tmp, file);
  return { ...report, store: file, code: report.failed.length ? 1 : 0 };
};
var evaluate = ({ root, timeoutMs = 1e4, now = Date.now() }) => {
  const regPath = join2(root, REGISTRY_FILE);
  if (!existsSync2(regPath))
    return { code: 3, rows: [], fatal: `no ${REGISTRY_FILE} at ${root}` };
  const reg = validateRegistry(readFileSync(regPath, "utf8"));
  if (reg.error)
    return { code: 2, rows: [], fatal: reg.error };
  const files = liveScope(root);
  if (files.length === 0)
    return { code: 3, rows: [], fatal: "no files in scope: could not check, not clean" };
  const rows = [];
  const contents = new Map;
  for (const abs of files) {
    const content = readFileSync(abs, "utf8");
    contents.set(abs, content);
    for (const row of scanFile(content, relative2(root, abs)))
      rows.push({ ...row, abs });
  }
  const used = rows.filter((r) => r.name && !r.result && reg.entries[r.name]).map((r) => r.name);
  const fileNames = new Set(used.filter((n) => reg.entries[n].kind === "file"));
  const values = resolveFileValues(fileNames, reg.entries, { root, timeoutMs });
  const store = used.some((n) => reg.entries[n].kind === "snapshot") ? loadStore(root) : { entries: null };
  for (const r of rows) {
    if (r.result)
      continue;
    const e = reg.entries[r.name];
    if (!e) {
      Object.assign(r, { result: "UNKNOWN", detail: `no "${r.name}" in ${REGISTRY_FILE}` });
      continue;
    }
    if (e.kind === "snapshot") {
      Object.assign(r, store.error ? { result: "QUERY_FAILED", code: 3, detail: store.error } : judgeSnapshot(r, e, store, now));
      continue;
    }
    const v = values.get(r.name);
    if (v.error) {
      Object.assign(r, { result: v.code === 1 ? "STALE" : "QUERY_FAILED", detail: v.error, code: v.code });
      continue;
    }
    const shown = render(v.raw, e.format, r.value);
    if (shown.error) {
      Object.assign(r, { result: "QUERY_FAILED", detail: shown.error, code: 3 });
      continue;
    }
    r.expected = shown.value;
    r.result = r.value === shown.value ? "OK" : "DRIFT";
  }
  const usedAny = new Set(rows.filter((r) => r.name).map((r) => r.name));
  for (const name of Object.keys(reg.entries)) {
    if (!usedAny.has(name))
      rows.push({ file: REGISTRY_FILE, line: 0, name, result: "UNUSED", detail: "registered but no doc shows it; drop it or add a marker" });
  }
  const has = (pred) => rows.some(pred);
  const code = has((r) => r.result === "QUERY_FAILED" && r.code === 3) ? 3 : has((r) => r.result !== "OK") ? 1 : 0;
  return { code, rows, contents };
};
var writeDrift = (result) => {
  const byFile = new Map;
  for (const r of result.rows)
    if (r.result === "DRIFT")
      (byFile.get(r.abs) ?? byFile.set(r.abs, []).get(r.abs)).push(r);
  const written = [];
  for (const [abs, drifts] of byFile) {
    const lines = result.contents.get(abs).split(`
`);
    drifts.sort((a, b) => a.line - b.line || b.start - a.start);
    for (const r of drifts) {
      const line = lines[r.line - 1];
      lines[r.line - 1] = `${line.slice(0, r.start)}<!-- live:${r.name} -->${r.expected}<!-- /live -->${line.slice(r.end)}`;
      r.result = "WRITTEN";
    }
    const next = lines.join(`
`);
    if (next === result.contents.get(abs))
      continue;
    const tmp = `${abs}.live-values.tmp`;
    writeFileSync(tmp, next, { mode: statSync(abs).mode });
    renameSync(tmp, abs);
    written.push(drifts[0].file);
  }
  return written;
};
var BLOCKS_COMMIT = new Set(["UNKNOWN", "UNUSED", "MALFORMED", "MISPLACED"]);
var hasUnstagedChanges = (root, file) => {
  try {
    execFileSync2("git", ["diff", "--quiet", "--", file], { cwd: root, stdio: "ignore" });
    return false;
  } catch (err) {
    if (err.status === 1)
      return true;
    throw new Error(`git diff failed for ${file}: ${err.message}`);
  }
};
var runHook = (result, root) => {
  const targets = [...new Set(result.rows.filter((r) => r.result === "DRIFT").map((r) => r.file))];
  const refused = targets.filter((f) => hasUnstagedChanges(root, f));
  if (refused.length > 0)
    return { written: [], refused };
  const written = writeDrift(result);
  if (written.length > 0)
    execFileSync2("git", ["add", "--", ...written], { cwd: root, stdio: "ignore" });
  return { written, refused };
};
var userTimerEnabled = () => {
  try {
    execFileSync2("systemctl", ["--user", "is-enabled", "live-snapshots.timer"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};
var storeHealth = ({ root, now = Date.now(), timerEnabled = userTimerEnabled }) => {
  const regPath = join2(root, REGISTRY_FILE);
  if (!existsSync2(regPath))
    return [];
  const reg = validateRegistry(readFileSync(regPath, "utf8"));
  if (reg.error)
    return [];
  const names = Object.entries(reg.entries).filter(([, e]) => e.kind === "snapshot");
  if (!names.length)
    return [];
  if (!timerEnabled()) {
    return ["automatic snapshot refresh is NOT enabled - snapshot values go stale and --check fails on age. Schedule a daily run: live-values.mjs --snapshot (cron, a scheduler, or a user timer)"];
  }
  const store = loadStore(root);
  if (store.error)
    return [`${store.error} - the next scheduled --snapshot run rewrites it`];
  if (!store.entries)
    return [`no snapshot store at ${storePath(root)} - run --snapshot where the store lives, then --write`];
  const behind = [];
  for (const [name, e] of names) {
    const s = store.entries[name];
    const at = Date.parse(s?.measuredAt);
    if (!s || Number.isNaN(at)) {
      behind.push(`${name}(never measured)`);
      continue;
    }
    const age = Math.floor((now - at) / DAY_MS);
    if (age > e.maxAgeDays)
      behind.push(`${name}(${age}d>${e.maxAgeDays}d)`);
  }
  return behind.length ? [`snapshot store has stale entries: ${behind.join(" ")} - the scheduled --snapshot run may be failing`] : [];
};
var USAGE = [
  "usage: node scripts/live-values.mjs (--check | --write | --hook | --list | --snapshot | --store-health) [--format=json]",
  "  --check        read-only: does every <!-- live:NAME --> span equal its value?",
  "  --write        rewrite drifted spans from their sources (atomic, per file)",
  "  --hook         pre-commit: --write, then git add the rewritten files; refuses a file with unstaged changes",
  "  --list         registry names with kind, format and where each is shown",
  "  --snapshot     measure every kind:snapshot query into the store file (timer mode)",
  "  --store-health is the store being kept? one [live-values] line per problem, silent when healthy",
  "  --format=json  machine-readable rows",
  "exit: 0 ok, 1 drift/unknown/unused/stale/malformed/misplaced, 2 usage, 3 could not check",
  "      --hook: 1 only for a refused file or a marker error; a query or snapshot it cannot check here is left to CI",
  "      --snapshot: 1 when any query failed (old values kept); 2 on a bad registry or store",
  "      --store-health: 1 when it printed a problem"
].join(`
`);
var MODES = ["--check", "--write", "--hook", "--list", "--snapshot", "--store-health"];
var KNOWN = new Set([...MODES, "--format=json", "--format=text", "--help", "-h"]);
var main = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((a) => !KNOWN.has(a));
  const modes = argv.filter((a) => MODES.includes(a));
  if (unknown.length || modes.length !== 1) {
    console.error(`${unknown.length ? `live-values: unknown argument: ${unknown.join(" ")}` : "live-values: pick exactly one of --check, --write, --hook, --list, --snapshot, --store-health"}
${USAGE}`);
    return 2;
  }
  const mode = modes[0];
  const json = argv.includes("--format=json");
  const root = rootOf(import.meta.url);
  const timeoutMs = Number(process.env.LIVE_VALUES_TIMEOUT_MS ?? 1e4);
  if (mode === "--store-health") {
    const problems = storeHealth({ root });
    if (json)
      console.log(JSON.stringify({ root, mode: "store-health", store: storePath(root), problems }, null, 2));
    else
      for (const p of problems)
        console.log(`[live-values] ⚠ ${p}`);
    return problems.length ? 1 : 0;
  }
  if (mode === "--snapshot") {
    const snapTimeout = Number(process.env.LIVE_VALUES_SNAPSHOT_TIMEOUT_MS ?? 60000);
    const r = runSnapshots({ root, timeoutMs: snapTimeout });
    if (r.fatal) {
      console.error(`live-values: ${r.fatal}`);
      return r.code;
    }
    if (json) {
      console.log(JSON.stringify({ root, mode: "snapshot", ...r }, null, 2));
      return r.code;
    }
    for (const f of r.failed)
      console.log(`FAILED       ${f.name}  kept or missing: ${f.error}`);
    console.log(`live-values: snapshot store ${r.store}: ${r.measured.length} measured, ${r.kept.length} kept (old value), ${r.missing.length} never measured, ${r.failed.length} failed`);
    return r.code;
  }
  if (mode === "--list") {
    const regPath = join2(root, REGISTRY_FILE);
    const reg = existsSync2(regPath) ? validateRegistry(readFileSync(regPath, "utf8")) : { error: `no ${REGISTRY_FILE}` };
    if (reg.error) {
      console.error(`live-values: ${reg.error}`);
      return 2;
    }
    const uses = new Map;
    for (const abs of liveScope(root))
      for (const r of scanFile(readFileSync(abs, "utf8"), relative2(root, abs)))
        if (r.name)
          (uses.get(r.name) ?? uses.set(r.name, []).get(r.name)).push(`${r.file}:${r.line}`);
    const list = Object.entries(reg.entries).map(([name, e]) => ({ name, kind: e.kind, format: e.format, uses: uses.get(name) ?? [] }));
    if (json)
      console.log(JSON.stringify(list, null, 2));
    else
      for (const l of list)
        console.log(`${l.name}  ${l.kind}/${l.format}  ${l.uses.length ? l.uses.join(", ") : "(unused)"}`);
    return 0;
  }
  const result = evaluate({ root, timeoutMs });
  if (result.fatal) {
    console.error(`live-values: ${result.fatal}`);
    return result.code;
  }
  let written = [];
  let refused = [];
  if (mode === "--write")
    written = writeDrift(result);
  if (mode === "--hook")
    ({ written, refused } = runHook(result, root));
  const rows = result.rows.map(({ abs, start, end, code: code2, ...r }) => r);
  const count = (k) => rows.filter((r) => r.result === k).length;
  const code = mode === "--hook" ? refused.length > 0 || rows.some((r) => BLOCKS_COMMIT.has(r.result)) ? 1 : 0 : rows.some((r) => r.result === "QUERY_FAILED") ? 3 : rows.some((r) => !["OK", "WRITTEN"].includes(r.result)) ? 1 : 0;
  for (const f of refused) {
    console.error(`live-values: refusing to rewrite ${f}: it has unstaged changes that git add would sweep into this commit. Stage or stash them, or run --write and stage by hand.`);
  }
  if (mode === "--hook" && (count("QUERY_FAILED") > 0 || count("STALE") > 0)) {
    console.error(`live-values: ${count("QUERY_FAILED")} value(s) could not be computed here and ${count("STALE")} snapshot(s) are past maxAge; not blocking the commit, CI's --check is the gate.`);
  }
  if (json) {
    console.log(JSON.stringify({ root, mode: mode.slice(2), written, refused, rows }, null, 2));
    return code;
  }
  for (const r of rows) {
    if (r.result === "OK")
      continue;
    const shown = r.result === "DRIFT" || r.result === "WRITTEN" ? `doc ${JSON.stringify(r.value)} → ${JSON.stringify(r.expected)}` : r.detail;
    console.log(`${r.result.padEnd(12)} ${r.file}:${r.line}  ${r.name ?? ""}  ${shown}`);
  }
  const markers = rows.filter((r) => r.file !== REGISTRY_FILE).length;
  console.log(`live-values: ${markers} marker(s); ${count("OK")} ok, ${count("DRIFT")} drift, ${count("WRITTEN")} written, ` + `${count("UNKNOWN") + count("UNUSED")} unknown/unused, ${count("STALE")} stale, ` + `${count("MALFORMED") + count("MISPLACED")} malformed/misplaced, ${count("QUERY_FAILED")} could not check`);
  return code;
};
if (isMainModule(import.meta.url)) {
  let code;
  try {
    code = main(process.argv.slice(2));
  } catch (err) {
    console.error(`live-values: could not check: ${String(err?.stack ?? err).split(`
`).slice(0, 3).join(" | ")}`);
    code = 3;
  }
  process.exit(code);
}
export {
  writeDrift,
  validateRegistry,
  storePath,
  storeHealth,
  scanFile,
  runSnapshots,
  runHook,
  rootOf,
  evaluate,
  checkFileQuery,
  STORE_ENV,
  REGISTRY_FILE,
  FILE_TOOLS
};

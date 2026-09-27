#!/usr/bin/env node
// Live values: a number or list in the prose is computed from its source, not
// typed. The doc carries the value between two HTML comments that name it:
//
//   This repo has <!-- live:workflow-count -->six<!-- /live --> workflows.
//
// GitHub renders only `six`, because both comments are invisible. The
// registry, live-values.json at the repo root, maps each NAME to the one
// command that prints its value:
//
//   { "workflow-count": { "run": "ls .github/workflows/*.yml | wc -l",
//                         "kind": "file", "format": "word" } }
//
// `kind: file` values are computed from the checkout alone, on a CI runner with
// no auth. Every command in the query must be in FILE_TOOLS; there are no
// absolute or `~` paths, and no git history (CI clones at depth 1).
// `kind: snapshot` values come from a machine, an account or the network.
// `--snapshot` (run daily by a scheduler) measures them into a store file,
// `data/live-snapshots.json` beside the registry (gitignored;
// LIVE_VALUES_STORE overrides), as `{ NAME: { value, measuredAt } }`.
// The store is machine state, so every worktree and the pre-commit hook read
// the one file the scheduler writes. A snapshot span carries its own date:
//
//   the box runs <!-- live:runners -->5 (measured 2026-09-26)<!-- /live --> runners
//
// so CI, which has no store, still checks it: the span's date must be within
// `maxAgeDays`. Where the store exists, the value must also equal it, and
// `--write` refreshes the date once half the window has passed - a bounded
// churn of one date edit per half-window, not one per day.
//
// Formats: `int` (digits), `word` (0–20 spelled out, keeping the span's
// capitalisation), `text` (the query's one line, verbatim).
//
// Why a separate checker is not enough: a proof catches drift after someone
// typed the number, and a human still types it again. Here the value has one
// source, `--write` fills it in, and CI's `--check` refuses a PR whose span
// disagrees with its source.
//
// Placement rules. Each rule was measured against the renderers that read
// these docs or against a probe parser (design notes in docs/grammar.md):
//   - never the first token of a line (after any list or quote marker). A line
//     that opens with `<!--` starts a CommonMark HTML block, and the rest of
//     the line then renders with no markdown (MALFORMED);
//   - never after a `<!-- proof: … -->` on the same line. proof-sweep reads
//     to the last `-->`, so the proof would parse as bad JSON (MALFORMED);
//   - never inside an AUTO-GEN block, whose lines a generator owns
//     (MISPLACED);
//   - one line per marker, no nesting. Markers inside fenced code or
//     backticks are text, so a doc can show the grammar.
//
// Usage:
//   node scripts/live-values.mjs --check [--format=json]   read-only verdict
//   node scripts/live-values.mjs --write                   rewrite drifted spans
//   node scripts/live-values.mjs --hook                    pre-commit: --write + git add (lefthook.yml)
//   node scripts/live-values.mjs --list                    registry names, uses
//   node scripts/live-values.mjs --snapshot                measure snapshot queries (timer)
//   node scripts/live-values.mjs --store-health            is the store kept? (hook, loka)
//   node scripts/live-values.mjs --help                    this text; writes nothing
//
// Exit, highest first: 2 usage (bad argument or bad registry entry), 3 could
// not check (a query failed or printed a value not in its format, a snapshot
// is missing, nothing in scope), 1 drift (a span differs from its value, an
// unknown NAME, an unused registry entry, a stale snapshot, a MALFORMED or
// MISPLACED marker), 0 every span equals its value. Callers read
// `--format=json`, never the bare code.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isMainModule } from "./lib/cli-entry.mjs";
import { resolveRoot } from "./lib/config-root.mjs";
import { autogenMask, checkQuerySegments, LOCAL_TOOLS, liveScope, runCommand } from "./lib/doc-scope.mjs";
import { commandWord, shellWords, splitSegments, stripQuoted } from "./lib/shell-command.mjs";

export const REGISTRY_FILE = "live-values.json";
export const STORE_ENV = "LIVE_VALUES_STORE";
// Which tree to check: LIVE_VALUES_ROOT, then the CLAUDE_CONFIG_ROOT and
// AGENT_CONFIG_HOME aliases, then the checkout holding this file. See
// lib/config-root.mjs for the order.
export const rootOf = (metaUrl) => resolveRoot(metaUrl ?? import.meta.url);
export const storePath = (root) => process.env[STORE_ENV] || join(root, "data", "live-snapshots.json");
// A snapshot span's text: the value, then its measurement date.
const SNAP_SPAN_RE = /^(.*) \(measured (\d{4}-\d{2}-\d{2})\)$/su;
const dated = (value, iso) => `${value} (measured ${iso.slice(0, 10)})`;
const DAY_MS = 86400000;

// Pure text tools on top of proof-sweep's local lane. Nothing here reaches the
// network or an account.
export const FILE_TOOLS = new Set([
  ...LOCAL_TOOLS,
  "find", "awk", "sed", "python3", "sort", "uniq", "cut", "tr", "head", "tail", "paste", "printf", "echo",
]);
const HISTORY_GIT = new Set(["log", "rev-list", "shortlog", "describe", "blame", "reflog"]);
const FORMATS = new Set(["int", "word", "text"]);
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ");

const MARKER_RE = /<!-- live:([a-z0-9][a-z0-9-]*) -->((?:(?!<!--)[^\n])*?)<!-- \/live -->/g;
const OPENER_RE = /<!--\s*live:/g;
const CLOSER_RE = /<!--\s*\/live\s*-->/g;
// What may precede a marker at the start of a line and still leave it the
// line's first token: indentation, list markers, blockquote markers.
// A list marker needs whitespace after it: `**` or `*` glued to the marker is
// emphasis, not a list item, and GitHub renders it (measured 2026-09-26).
const LINE_START_RE = /^(?:\s*(?:[-*+]\s|\d+[.)]\s|>))*\s*$/;

// ---- registry ---------------------------------------------------------------

// Returns { entries } or { error } — every defect named, never a partial map.
export const validateRegistry = (raw) => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { error: `${REGISTRY_FILE} is not JSON: ${err.message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: `${REGISTRY_FILE} must be an object of NAME → entry` };
  const problems = [];
  for (const [name, e] of Object.entries(data)) {
    if (!NAME_RE.test(name)) problems.push(`${name}: name must match ${NAME_RE}`);
    if (!e || typeof e !== "object") { problems.push(`${name}: entry must be an object`); continue; }
    const want = e.kind === "snapshot" ? ["format", "kind", "maxAgeDays", "run"] : ["format", "kind", "run"];
    const keys = Object.keys(e).sort();
    if (keys.join() !== want.join()) problems.push(`${name}: keys must be exactly {${want.join(", ")}}, got {${keys.join(", ")}}`);
    if (e.kind !== "file" && e.kind !== "snapshot") problems.push(`${name}: kind must be "file" or "snapshot"`);
    if (!FORMATS.has(e.format)) problems.push(`${name}: format must be one of ${[...FORMATS].join(", ")}`);
    if (typeof e.run !== "string" || !e.run.trim()) problems.push(`${name}: run must be a non-empty string`);
    if (e.kind === "snapshot" && !(Number.isInteger(e.maxAgeDays) && e.maxAgeDays > 0)) problems.push(`${name}: maxAgeDays must be a positive integer`);
    if (e.kind === "file" && typeof e.run === "string") {
      const gate = checkFileQuery(e.run);
      if (!gate.ok) problems.push(`${name}: kind "file" query ${gate.reason}`);
    }
  }
  return problems.length ? { error: problems.join("\n") } : { entries: data };
};

// A kind:file query must run on a bare CI checkout: allowlisted commands only,
// no machine paths, no git history.
export const checkFileQuery = (run) => {
  const seg = checkQuerySegments(run, FILE_TOOLS);
  if (!seg.ok) return { ok: false, reason: seg.reason };
  for (const s of splitSegments(run)) {
    // Quoted text is a pattern or a program (`grep -F 'docs/guide.md'`,
    // an awk script), not a path the command opens.
    const bare = stripQuoted(s).split(/\s+/).filter(Boolean);
    const abs = bare.find((w) => /^(\/|~|\$HOME)/.test(w));
    if (abs) return { ok: false, reason: `names a machine path: ${abs}` };
    const words = shellWords(s);
    const word = commandWord(words);
    if (word === "git") {
      const sub = words.slice(words.indexOf("git") + 1).find((w, i, a) => !w.startsWith("-") && a[i - 1] !== "-C");
      if (HISTORY_GIT.has(sub)) return { ok: false, reason: `reads git history (git ${sub}); CI clones at depth 1` };
    }
    if (word === "find" && words.some((w) => /^-(exec|execdir|ok|okdir)$/.test(w))) {
      return { ok: false, reason: "uses find -exec, which runs a command the gate cannot see" };
    }
  }
  return { ok: true };
};

// ---- markers ------------------------------------------------------------------

// Blank out inline code spans, keeping every index: a marker inside backticks
// is text, and a rewrite must still land on the original columns.
const maskCodeSpans = (line) => line.replace(/(`+)[^`]*?\1/g, (m) => " ".repeat(m.length));

// Every marker in one file, and every placement defect, with 1-based lines.
export const scanFile = (content, file) => {
  const lines = content.split("\n");
  const inBlock = autogenMask(lines);
  const found = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
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
      if (inBlock[i]) Object.assign(row, { result: "MISPLACED", detail: "inside an AUTO-GEN block; the generator owns this line" });
      else if (LINE_START_RE.test(text.slice(0, m.index))) Object.assign(row, { result: "MALFORMED", detail: "first token of the line: GitHub renders the rest of the line as raw HTML; put a word before it" });
      else if (proofAt !== -1 && proofAt < m.index) Object.assign(row, { result: "MALFORMED", detail: "after a proof comment on the same line: proof-sweep would read it as bad JSON; put it before the proof" });
      found.push(row);
    }
  });
  return found;
};

// ---- values -------------------------------------------------------------------

const render = (raw, format, current) => {
  const v = raw.replace(/\s+$/u, "");
  if (format === "int") return /^\d+$/.test(v) ? { value: v } : { error: `not an int: ${JSON.stringify(v.slice(0, 60))}` };
  if (format === "word") {
    if (!/^\d+$/.test(v) || Number(v) >= WORDS.length) return { error: `not an int 0–${WORDS.length - 1}: ${JSON.stringify(v.slice(0, 60))}` };
    const w = WORDS[Number(v)];
    return { value: /^[A-Z]/.test(current ?? "") ? w[0].toUpperCase() + w.slice(1) : w };
  }
  if (!v || v.includes("\n") || v.includes("<!--")) return { error: `text value must be one non-empty line with no comment: ${JSON.stringify(v.slice(0, 60))}` };
  return { value: v };
};

// Run each used kind:file query once: { raw } or { error, code: 3 }.
const resolveFileValues = (names, entries, { root, timeoutMs }) => {
  const out = new Map();
  for (const name of names) {
    const r = runCommand(entries[name].run, { root, timeoutMs });
    out.set(name, r.ok ? { raw: r.stdout } : { error: `query failed: ${r.output}`, code: 3 });
  }
  return out;
};

// The store as { entries } when present, { entries: null } when absent (CI),
// { error } when unreadable.
const loadStore = (root) => {
  const p = storePath(root);
  if (!existsSync(p)) return { entries: null };
  try {
    return { entries: JSON.parse(readFileSync(p, "utf8")) };
  } catch (err) {
    return { error: `${p} is not JSON: ${err.message}` };
  }
};

// Verdict for one snapshot span. The span's own date is checked everywhere;
// the value is checked only where this machine's store has it.
const judgeSnapshot = (r, e, store, now) => {
  const m = r.value.match(SNAP_SPAN_RE);
  const s = store.entries?.[r.name];
  const valid = s && typeof s.value === "string" && !Number.isNaN(Date.parse(s.measuredAt));
  if (valid) {
    const storeAge = (now - Date.parse(s.measuredAt)) / DAY_MS;
    if (storeAge > e.maxAgeDays) {
      return { result: "STALE", code: 1, detail: `store value is ${storeAge.toFixed(1)} days old, maxAgeDays ${e.maxAgeDays}: the scheduled --snapshot run is behind` };
    }
    const shown = render(s.value, e.format, m ? m[1] : r.value);
    if (shown.error) return { result: "QUERY_FAILED", code: 3, detail: shown.error };
    const expected = dated(shown.value, s.measuredAt);
    if (!m || m[1] !== shown.value) return { result: "DRIFT", expected };
    const spanAge = (now - Date.parse(`${m[2]}T00:00:00Z`)) / DAY_MS;
    const newer = s.measuredAt.slice(0, 10) > m[2];
    if (newer && spanAge >= e.maxAgeDays / 2) return { result: "DRIFT", expected };
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


// Measure every `kind: snapshot` entry and merge it into the store file.
// One failure never stops the rest: a failed query KEEPs the old value with
// its old measuredAt (maintainer decision — maxAge then flags it), never
// omits. A value that was never measured stays absent, and --check falls
// back to the span's own date for it. The write is atomic (tmp + rename). Returns
// { measured, kept, failed, missing } with per-name errors for the report.
export const runSnapshots = ({ root, timeoutMs = 60000, now = Date.now() }) => {
  const regPath = join(root, REGISTRY_FILE);
  if (!existsSync(regPath)) return { fatal: `no ${REGISTRY_FILE} at ${root}`, code: 2 };
  const reg = validateRegistry(readFileSync(regPath, "utf8"));
  if (reg.error) return { fatal: reg.error, code: 2 };
  const names = Object.entries(reg.entries)
    .filter(([, e]) => e.kind === "snapshot")
    .map(([n]) => n);
  const file = storePath(root);
  let store = {};
  if (existsSync(file)) {
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
    // The raw value, not its rendering: a word-format value is spelled out
    // per span (keeping each span's capitalisation), so the store holds digits.
    store[name] = { value: r.stdout.replace(/\s+$/u, ""), measuredAt: at };
    report.measured.push(name);
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.live-values.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  renameSync(tmp, file);
  return { ...report, store: file, code: report.failed.length ? 1 : 0 };
};

export const evaluate = ({ root, timeoutMs = 10000, now = Date.now() }) => {
  const regPath = join(root, REGISTRY_FILE);
  if (!existsSync(regPath)) return { code: 3, rows: [], fatal: `no ${REGISTRY_FILE} at ${root}` };
  const reg = validateRegistry(readFileSync(regPath, "utf8"));
  if (reg.error) return { code: 2, rows: [], fatal: reg.error };
  const files = liveScope(root);
  if (files.length === 0) return { code: 3, rows: [], fatal: "no files in scope: could not check, not clean" };

  const rows = [];
  const contents = new Map();
  for (const abs of files) {
    const content = readFileSync(abs, "utf8");
    contents.set(abs, content);
    for (const row of scanFile(content, relative(root, abs))) rows.push({ ...row, abs });
  }
  const used = rows.filter((r) => r.name && !r.result && reg.entries[r.name]).map((r) => r.name);
  const fileNames = new Set(used.filter((n) => reg.entries[n].kind === "file"));
  const values = resolveFileValues(fileNames, reg.entries, { root, timeoutMs });
  const store = used.some((n) => reg.entries[n].kind === "snapshot") ? loadStore(root) : { entries: null };

  for (const r of rows) {
    if (r.result) continue;
    const e = reg.entries[r.name];
    if (!e) { Object.assign(r, { result: "UNKNOWN", detail: `no "${r.name}" in ${REGISTRY_FILE}` }); continue; }
    if (e.kind === "snapshot") {
      Object.assign(r, store.error ? { result: "QUERY_FAILED", code: 3, detail: store.error } : judgeSnapshot(r, e, store, now));
      continue;
    }
    const v = values.get(r.name);
    if (v.error) { Object.assign(r, { result: v.code === 1 ? "STALE" : "QUERY_FAILED", detail: v.error, code: v.code }); continue; }
    const shown = render(v.raw, e.format, r.value);
    if (shown.error) { Object.assign(r, { result: "QUERY_FAILED", detail: shown.error, code: 3 }); continue; }
    r.expected = shown.value;
    r.result = r.value === shown.value ? "OK" : "DRIFT";
  }
  const usedAny = new Set(rows.filter((r) => r.name).map((r) => r.name));
  for (const name of Object.keys(reg.entries)) {
    if (!usedAny.has(name)) rows.push({ file: REGISTRY_FILE, line: 0, name, result: "UNUSED", detail: "registered but no doc shows it; drop it or add a marker" });
  }

  const has = (pred) => rows.some(pred);
  const code = has((r) => r.result === "QUERY_FAILED" && r.code === 3)
    ? 3
    : has((r) => r.result !== "OK")
      ? 1
      : 0;
  return { code, rows, contents };
};

// Rewrite every DRIFT span to its value. Atomic per file; only files whose
// bytes change are touched. Returns the relative paths written.
export const writeDrift = (result) => {
  const byFile = new Map();
  for (const r of result.rows) if (r.result === "DRIFT") (byFile.get(r.abs) ?? byFile.set(r.abs, []).get(r.abs)).push(r);
  const written = [];
  for (const [abs, drifts] of byFile) {
    const lines = result.contents.get(abs).split("\n");
    // Right to left within a line, so earlier columns stay valid.
    drifts.sort((a, b) => a.line - b.line || b.start - a.start);
    for (const r of drifts) {
      const line = lines[r.line - 1];
      lines[r.line - 1] = `${line.slice(0, r.start)}<!-- live:${r.name} -->${r.expected}<!-- /live -->${line.slice(r.end)}`;
      r.result = "WRITTEN";
    }
    const next = lines.join("\n");
    if (next === result.contents.get(abs)) continue;
    const tmp = `${abs}.live-values.tmp`;
    writeFileSync(tmp, next, { mode: statSync(abs).mode });
    renameSync(tmp, abs);
    written.push(drifts[0].file);
  }
  return written;
};

// ---- pre-commit hook --------------------------------------------------------------
// `--hook` = `--write`, then `git add` of exactly the files it rewrote. Before
// writing, it refuses any file it would rewrite that has unstaged changes,
// because `git add` would sweep someone else's half-done edit into this
// commit. lefthook's `stage_fixed` cannot do this job: it re-adds only files
// that were already staged, and here the doc changes because its SOURCE
// changed (a new workflow file), so the doc was never staged.
//
// What blocks the commit (exit 1): a refused file, or an author error in a
// marker (UNKNOWN, UNUSED, MALFORMED, MISPLACED). What does not: a query that
// cannot run on this machine, or a snapshot older than its maxAge. Neither is
// the committer's doing, and a hook that fails for reasons outside the
// committer's control teaches --no-verify. CI's --check still refuses both.
const BLOCKS_COMMIT = new Set(["UNKNOWN", "UNUSED", "MALFORMED", "MISPLACED"]);

const hasUnstagedChanges = (root, file) => {
  try {
    execFileSync("git", ["diff", "--quiet", "--", file], { cwd: root, stdio: "ignore" });
    return false;
  } catch (err) {
    if (err.status === 1) return true;
    throw new Error(`git diff failed for ${file}: ${err.message}`);
  }
};

export const runHook = (result, root) => {
  const targets = [...new Set(result.rows.filter((r) => r.result === "DRIFT").map((r) => r.file))];
  const refused = targets.filter((f) => hasUnstagedChanges(root, f));
  if (refused.length > 0) return { written: [], refused };
  const written = writeDrift(result);
  if (written.length > 0) execFileSync("git", ["add", "--", ...written], { cwd: root, stdio: "ignore" });
  return { written, refused };
};

// ---- store health -------------------------------------------------------------

// Is automatic snapshot refresh enabled? The default probe asks the user's
// scheduler; pass timerEnabled to check any other arrangement. The engine
// keeps the logic (one problem line per defect, [] when healthy or when the
// registry has no kind:snapshot entry) and leaves the scheduling to the
// adopter: cron, a scheduler, or a user timer that runs `--snapshot` daily.
const userTimerEnabled = () => {
  try {
    execFileSync("systemctl", ["--user", "is-enabled", "live-snapshots.timer"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

// Is the snapshot store being kept? One problem line per defect, [] when
// healthy or when the registry has no kind:snapshot entry (nothing to keep).
// The ONE implementation behind both surfaces: the SessionStart hook
// (maintenance-status-check.sh, via --store-health) and loka-sweep.mjs.
export const storeHealth = ({ root, now = Date.now(), timerEnabled = userTimerEnabled }) => {
  const regPath = join(root, REGISTRY_FILE);
  if (!existsSync(regPath)) return [];
  const reg = validateRegistry(readFileSync(regPath, "utf8"));
  if (reg.error) return [];
  const names = Object.entries(reg.entries).filter(([, e]) => e.kind === "snapshot");
  if (!names.length) return [];
  if (!timerEnabled()) {
    return ["automatic snapshot refresh is NOT enabled - snapshot values go stale and --check fails on age. Schedule a daily run: live-values.mjs --snapshot (cron, a scheduler, or a user timer)"];
  }
  const store = loadStore(root);
  if (store.error) return [`${store.error} - the next scheduled --snapshot run rewrites it`];
  if (!store.entries) return [`no snapshot store at ${storePath(root)} - run --snapshot where the store lives, then --write`];
  const behind = [];
  for (const [name, e] of names) {
    const s = store.entries[name];
    const at = Date.parse(s?.measuredAt);
    if (!s || Number.isNaN(at)) { behind.push(`${name}(never measured)`); continue; }
    const age = Math.floor((now - at) / DAY_MS);
    if (age > e.maxAgeDays) behind.push(`${name}(${age}d>${e.maxAgeDays}d)`);
  }
  return behind.length
    ? [`snapshot store has stale entries: ${behind.join(" ")} - the scheduled --snapshot run may be failing`]
    : [];
};

// ---- CLI --------------------------------------------------------------------------

const USAGE = [
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
  "      --store-health: 1 when it printed a problem",
].join("\n");
const MODES = ["--check", "--write", "--hook", "--list", "--snapshot", "--store-health"];
const KNOWN = new Set([...MODES, "--format=json", "--format=text", "--help", "-h"]);

const main = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((a) => !KNOWN.has(a));
  const modes = argv.filter((a) => MODES.includes(a));
  if (unknown.length || modes.length !== 1) {
    console.error(`${unknown.length ? `live-values: unknown argument: ${unknown.join(" ")}` : "live-values: pick exactly one of --check, --write, --hook, --list, --snapshot, --store-health"}\n${USAGE}`);
    return 2;
  }
  const mode = modes[0];
  const json = argv.includes("--format=json");
  const root = rootOf(import.meta.url);
  const timeoutMs = Number(process.env.LIVE_VALUES_TIMEOUT_MS ?? 10000);

  if (mode === "--store-health") {
    const problems = storeHealth({ root });
    if (json) console.log(JSON.stringify({ root, mode: "store-health", store: storePath(root), problems }, null, 2));
    else for (const p of problems) console.log(`[live-values] ⚠ ${p}`);
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
    for (const f of r.failed) console.log(`FAILED       ${f.name}  kept or missing: ${f.error}`);
    console.log(
      `live-values: snapshot store ${r.store}: ${r.measured.length} measured, ${r.kept.length} kept (old value), ${r.missing.length} never measured, ${r.failed.length} failed`,
    );
    return r.code;
  }

  if (mode === "--list") {
    const regPath = join(root, REGISTRY_FILE);
    const reg = existsSync(regPath) ? validateRegistry(readFileSync(regPath, "utf8")) : { error: `no ${REGISTRY_FILE}` };
    if (reg.error) { console.error(`live-values: ${reg.error}`); return 2; }
    const uses = new Map();
    for (const abs of liveScope(root)) for (const r of scanFile(readFileSync(abs, "utf8"), relative(root, abs))) if (r.name) (uses.get(r.name) ?? uses.set(r.name, []).get(r.name)).push(`${r.file}:${r.line}`);
    const list = Object.entries(reg.entries).map(([name, e]) => ({ name, kind: e.kind, format: e.format, uses: uses.get(name) ?? [] }));
    if (json) console.log(JSON.stringify(list, null, 2));
    else for (const l of list) console.log(`${l.name}  ${l.kind}/${l.format}  ${l.uses.length ? l.uses.join(", ") : "(unused)"}`);
    return 0;
  }

  const result = evaluate({ root, timeoutMs });
  if (result.fatal) {
    console.error(`live-values: ${result.fatal}`);
    return result.code;
  }
  let written = [];
  let refused = [];
  if (mode === "--write") written = writeDrift(result);
  if (mode === "--hook") ({ written, refused } = runHook(result, root));
  const rows = result.rows.map(({ abs, start, end, code, ...r }) => r);
  const count = (k) => rows.filter((r) => r.result === k).length;
  // After --write, the drift that was rewritten no longer counts.
  const code =
    mode === "--hook"
      ? refused.length > 0 || rows.some((r) => BLOCKS_COMMIT.has(r.result)) ? 1 : 0
      : rows.some((r) => r.result === "QUERY_FAILED") ? 3 : rows.some((r) => !["OK", "WRITTEN"].includes(r.result)) ? 1 : 0;
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
    if (r.result === "OK") continue;
    const shown = r.result === "DRIFT" || r.result === "WRITTEN" ? `doc ${JSON.stringify(r.value)} → ${JSON.stringify(r.expected)}` : r.detail;
    console.log(`${r.result.padEnd(12)} ${r.file}:${r.line}  ${r.name ?? ""}  ${shown}`);
  }
  const markers = rows.filter((r) => r.file !== REGISTRY_FILE).length;
  console.log(
    `live-values: ${markers} marker(s); ${count("OK")} ok, ${count("DRIFT")} drift, ${count("WRITTEN")} written, ` +
      `${count("UNKNOWN") + count("UNUSED")} unknown/unused, ${count("STALE")} stale, ` +
      `${count("MALFORMED") + count("MISPLACED")} malformed/misplaced, ${count("QUERY_FAILED")} could not check`,
  );
  return code;
};

if (isMainModule(import.meta.url)) {
  let code;
  try {
    code = main(process.argv.slice(2));
  } catch (err) {
    // A thrown error is "could not check", never node's own 1 (= drift here).
    console.error(`live-values: could not check: ${String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ")}`);
    code = 3;
  }
  process.exit(code);
}

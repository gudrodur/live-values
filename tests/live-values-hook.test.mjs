// live-values --hook inside a real git repository, the way lefthook runs it
// as pre-commit. What must hold:
//  - a doc that drifted because its SOURCE changed reaches the same commit,
//    even though nobody staged the doc (lefthook's stage_fixed would miss it);
//  - `git commit -a` gets the rewrite too (the hook's git add honours the
//    temporary index git hands it);
//  - a doc with someone's unstaged edit is refused, not swept into the commit;
//  - a query that cannot run here does not block the commit, but a marker
//    error does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackTemp } from "./lib/test-env.mjs";

const SCRIPT = fileURLToPath(new URL("../engine/live-values.mjs", import.meta.url));
const M = (name, v) => `<!-- live:${name} -->${v}<!-- /live -->`;
const REG = { "src-count": { run: "ls src/*.txt | wc -l", kind: "file", format: "int" } };

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();

/** A repo with one committed source file, a doc showing its count, and the hook installed. */
const repo = ({ registry = REG, doc = `We keep ${M("src-count", "1")} files.\n` } = {}) => {
  const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), "live-values-hook-")));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.invalid");
  git(root, "config", "user.name", "t");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.txt"), "a\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), doc);
  fs.writeFileSync(path.join(root, "live-values.json"), JSON.stringify(registry));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const hook = path.join(root, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, `#!/bin/sh\nCLAUDE_CONFIG_ROOT="${root}" exec "${process.execPath}" "${SCRIPT}" --hook\n`, { mode: 0o755 });
  return root;
};
const commit = (root, ...args) =>
  spawnSync("git", ["commit", "-q", "-m", "change", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
const shown = (root) => git(root, "show", "--name-only", "--format=", "HEAD").split("\n");

test("a source-only commit carries the rewritten doc with it", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "src", "b.txt"), "b\n");
  git(root, "add", "src/b.txt");
  const r = commit(root);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(shown(root).filter(Boolean).sort(), ["AGENTS.md", "src/b.txt"]);
  assert.equal(git(root, "show", "HEAD:AGENTS.md"), `We keep ${M("src-count", "2")} files.`);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("git commit -a carries the rewritten doc too", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "src", "a.txt"), "a2\n");
  fs.writeFileSync(path.join(root, "src", "b.txt"), "b\n");
  git(root, "add", "-N", "src/b.txt");
  const r = commit(root, "-a");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(shown(root).includes("AGENTS.md"), `commit -a lost the doc: ${shown(root)}`);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("a doc with an unstaged edit is refused, and the index is untouched", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "src", "b.txt"), "b\n");
  git(root, "add", "src/b.txt");
  fs.appendFileSync(path.join(root, "AGENTS.md"), "someone else's half-done line\n");
  const r = commit(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to rewrite AGENTS\.md: it has unstaged changes/);
  assert.equal(git(root, "diff", "--cached", "--name-only"), "src/b.txt");
  assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), new RegExp(`^We keep ${M("src-count", "1")}`));
});

test("a query that cannot run does not block the commit; a marker error does", () => {
  const broken = repo({ registry: { "src-count": { ...REG["src-count"], run: "cat no-such-file" } } });
  fs.writeFileSync(path.join(broken, "src", "b.txt"), "b\n");
  git(broken, "add", "src/b.txt");
  const ok = commit(broken);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /1 value\(s\) could not be computed here/);

  const bad = repo({ doc: `${M("src-count", "1")} files lead the line.\n` });
  fs.writeFileSync(path.join(bad, "src", "b.txt"), "b\n");
  git(bad, "add", "src/b.txt");
  assert.equal(commit(bad).status, 1);
  assert.equal(git(bad, "log", "--oneline").split("\n").length, 1, "the commit went through");
});

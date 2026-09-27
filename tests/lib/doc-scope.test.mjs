// Tests for the shared doc scope. Two gates here decide what a reader of the
// prose may trust. Each is shown both ways: it fires on its defect and stays
// quiet on the legitimate neighbour.
//  - autogenMask: whether a line is generated. The loose prefix regex it
//    replaced let a table cell that QUOTES the markers close the block, so the
//    106 rows after it read as hand-written.
//  - checkQuerySegments: whether a command can run on a CI runner with no
//    auth. The first-word gate passed a `gh` hidden behind a pipe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { autogenMask, checkLocal, checkQuerySegments, runCommand } from "../../engine/lib/doc-scope.mjs";

const mask = (text) => autogenMask(text.split("\n"));

test("a whole-line block masks its markers and body, and nothing outside", () => {
  assert.deepEqual(
    mask(["before", "<!-- AUTO-GEN:start t -->", "row", "<!-- AUTO-GEN:end t -->", "after"].join("\n")),
    [false, true, true, true, false],
  );
});

test("a row that quotes both markers keeps later rows inside the block", () => {
  const lines = [
    "<!-- AUTO-GEN:start scripts-table -->",
    "| `generate-docs.mjs` | node | Looks for <!-- AUTO-GEN:start <name> --> ... <!-- AUTO-GEN:end <name> --> blocks |",
    "| later row |",
    "<!-- AUTO-GEN:end scripts-table -->",
    "hand-written",
  ];
  assert.deepEqual(autogenMask(lines), [true, true, true, true, false]);
  // The old reader: an unanchored end test on each line after the start.
  let auto = false;
  const old = lines.map((l) => {
    if (/<!--\s*AUTO-GEN:start/.test(l)) auto = true;
    const inside = auto;
    if (/<!--\s*AUTO-GEN:end/.test(l)) auto = false;
    return inside;
  });
  assert.equal(old[2], false, "the old regex really did leak the later row out of the block");
});

test("an end marker of another name does not close the block", () => {
  assert.deepEqual(
    mask(["<!-- AUTO-GEN:start a -->", "<!-- AUTO-GEN:end b -->", "x", "<!-- AUTO-GEN:end a -->", "y"].join("\n")),
    [true, true, true, true, false],
  );
});

test("an unterminated block runs to the end of the file", () => {
  assert.deepEqual(mask(["<!-- AUTO-GEN:start a -->", "x", "y"].join("\n")), [true, true, true]);
});

test("a stray end marker with no open block is ordinary text", () => {
  assert.deepEqual(mask(["<!-- AUTO-GEN:end a -->", "x"].join("\n")), [false, false]);
});

test("checkQuerySegments passes an all-local pipeline", () => {
  assert.deepEqual(checkQuerySegments(`jq '.mcpServers|length' mcp-servers.json | wc -l`), { ok: true });
  assert.deepEqual(checkQuerySegments(`grep -c x a.md && cat b.md; git ls-files '*.md' | wc -l`), { ok: true });
});

test("checkQuerySegments refuses a non-local command after a pipe, where checkLocal does not", () => {
  const run = `jq ".mcpServers|length" mcp-servers.json | gh api repos/x`;
  assert.equal(checkLocal(run, "/").ok, true, "the first-word gate passes it");
  assert.deepEqual(checkQuerySegments(run), { ok: false, reason: "command not allowed: gh", word: "gh" });
});

test("checkQuerySegments gates command substitutions, but not quoted text", () => {
  assert.equal(checkQuerySegments(`wc -l $(gcloud secrets list)`).word, "gcloud");
  assert.equal(checkQuerySegments("cat `curl -s x`").word, "curl");
  assert.deepEqual(checkQuerySegments(`grep -c 'gh api | curl $(x)' a.md`), { ok: true });
});

test("checkQuerySegments reads through compound-command keywords", () => {
  assert.deepEqual(checkQuerySegments(`for f in a b; do wc -l "$f"; done`), { ok: true });
  assert.equal(checkQuerySegments(`for f in a b; do curl "$f"; done`).word, "curl");
  assert.equal(checkQuerySegments(`if gh auth status; then cat x; fi`).word, "gh");
});

test("checkQuerySegments takes a caller's allowlist", () => {
  assert.deepEqual(checkQuerySegments(`awk '{n++} END{print n}' a.md`, new Set(["awk"])), { ok: true });
  assert.equal(checkQuerySegments(`awk 1 a.md`).word, "awk");
});

test("runCommand returns stdout, and a failure as text that is never empty", () => {
  assert.deepEqual(runCommand("printf 7", { root: "/", timeoutMs: 5000 }), { ok: true, stdout: "7" });
  const bad = runCommand("exit 3", { root: "/", timeoutMs: 5000 });
  assert.equal(bad.ok, false);
  assert.equal(bad.timedOut, false);
  assert.ok(bad.output.length > 0);
  const slow = runCommand("sleep 5", { root: "/", timeoutMs: 200 });
  assert.equal(slow.timedOut, true);
  assert.match(slow.output, /^timed out after 200 ms/);
});

test("liveScope adds a project's tracked agent docs, never untracked files, INDEX.md or symlinks", async () => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { liveScope } = await import("../../engine/lib/doc-scope.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-scope-"));
  try {
    const put = (p, s = "x\n") => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };
    for (const p of ["CLAUDE.md", "README.md", "docs/deep/nested.md", ".claude/skills/a/SKILL.md", "docs/INDEX.md", "src/notes.md"]) put(p);
    fs.mkdirSync(path.join(root, "vendor/b"), { recursive: true });
    fs.writeFileSync(path.join(root, "vendor/b/SKILL.md"), "x\n");
    fs.symlinkSync(path.join(root, "vendor/b"), path.join(root, ".claude/skills/b"));
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "add", "-A"]);
    put("docs/untracked.md");
    const got = liveScope(root).map((a) => path.relative(root, a)).sort();
    assert.deepEqual(got, [".claude/skills/a/SKILL.md", "CLAUDE.md", "README.md", "docs/deep/nested.md"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

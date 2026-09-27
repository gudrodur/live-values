// live-values.mjs is a gate: CI's --check refuses a PR whose number disagrees
// with its source, and --write is how a person makes it agree. Each rule is
// shown both ways, the defect caught and its legitimate neighbour passed,
// through the real CLI in a scratch root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackTemp } from "./lib/test-env.mjs";
import { checkFileQuery, scanFile, storeHealth } from "../engine/live-values.mjs";

const SCRIPT = fileURLToPath(new URL("../engine/live-values.mjs", import.meta.url));
const M = (name, v) => `<!-- live:${name} -->${v}<!-- /live -->`;
const THREE = { run: "printf 3", kind: "file", format: "int" };

/** A scratch root: AGENTS.md text, a registry, optional snapshot store. */
const sandbox = ({ doc, registry = { three: THREE }, snapshot }) => {
  const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), "live-values-")));
  fs.writeFileSync(path.join(root, "AGENTS.md"), doc);
  if (registry !== null) fs.writeFileSync(path.join(root, "live-values.json"), JSON.stringify(registry));
  if (snapshot) fs.writeFileSync(path.join(root, "store.json"), JSON.stringify(snapshot));
  return root;
};
// The store path is always inside the scratch root, so no test reads or
// writes this machine's real store.
const storeOf = (root) => path.join(root, "store.json");
const cli = (root, ...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_ROOT: root, LIVE_VALUES_STORE: storeOf(root) },
  });
const doc = (root) => fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
const rows = (r) => JSON.parse(r.stdout).rows;

test("a span equal to its value is ok (exit 0)", () => {
  const root = sandbox({ doc: `We run ${M("three", "3")} servers.\n` });
  assert.equal(cli(root, "--check").status, 0);
});

test("drift is exit 1; --write fixes only the span; the next --check is 0", () => {
  const src = `# T\n\nWe run ${M("three", "2")} servers, not more.\n`;
  const root = sandbox({ doc: src });
  const check = cli(root, "--check", "--format=json");
  assert.equal(check.status, 1);
  assert.deepEqual(rows(check).map((r) => [r.result, r.value, r.expected]), [["DRIFT", "2", "3"]]);
  assert.equal(doc(root), src, "--check wrote");
  assert.equal(cli(root, "--write").status, 0);
  assert.equal(doc(root), src.replace(M("three", "2"), M("three", "3")));
  assert.equal(cli(root, "--check").status, 0);
});

test("a table cell survives --write, including two markers in one row", () => {
  const src = `| a | b |\n|---|---:|\n| servers | ${M("three", "9")} of ${M("three", "1")} |\n`;
  const root = sandbox({ doc: src });
  assert.equal(cli(root, "--write").status, 0);
  assert.equal(doc(root), `| a | b |\n|---|---:|\n| servers | ${M("three", "3")} of ${M("three", "3")} |\n`);
});

test("word format spells the number and keeps the span's capital", () => {
  const reg = { three: { ...THREE, format: "word" } };
  const root = sandbox({ doc: `We run ${M("three", "two")} servers. ${M("three", "Two")} work.\n`, registry: reg });
  assert.equal(cli(root, "--write").status, 0);
  assert.equal(doc(root), `We run ${M("three", "three")} servers. ${M("three", "Three")} work.\n`);
});

test("an unknown NAME is exit 1, and a registered name no doc shows is exit 1", () => {
  const unknown = sandbox({ doc: `We run ${M("nope", "3")} servers.\n` });
  assert.deepEqual(rows(cli(unknown, "--check", "--format=json")).map((r) => r.result), ["UNKNOWN", "UNUSED"]);
  const unused = sandbox({ doc: "No markers.\n" });
  const r = cli(unused, "--check", "--format=json");
  assert.equal(r.status, 1);
  assert.deepEqual(rows(r).map((x) => [x.result, x.name]), [["UNUSED", "three"]]);
});

test("a marker that opens a line, list item or quote is MALFORMED; a word before it is fine", () => {
  for (const bad of [`${M("three", "3")} servers.`, `- ${M("three", "3")} servers`, `* ${M("three", "3")} servers`, `1. ${M("three", "3")} servers`, `> ${M("three", "3")} servers`, `  ${M("three", "3")} servers`]) {
    const r = cli(sandbox({ doc: `${bad}\n` }), "--check", "--format=json");
    assert.equal(r.status, 1, bad);
    assert.equal(rows(r)[0].result, "MALFORMED", bad);
  }
  // Emphasis glued to the marker is not a list item: GitHub renders it.
  for (const good of [`We run ${M("three", "3")} servers.`, `- we run ${M("three", "3")}`, `| ${M("three", "3")} |`, `## ${M("three", "3")} servers`, `**${M("three", "3")} servers** run.`, `*${M("three", "3")} servers* run.`, `- **${M("three", "3")} servers**`]) {
    assert.equal(cli(sandbox({ doc: `${good}\n` }), "--check").status, 0, good);
  }
});

test("a marker after a proof on the same line is MALFORMED; before the proof is fine", () => {
  const proof = `<!-- proof: {"run": "echo 3", "match": "^3$"} -->`;
  const after = cli(sandbox({ doc: `We run 3 ${proof} and ${M("three", "3")}.\n` }), "--check", "--format=json");
  assert.equal(after.status, 1);
  assert.match(rows(after)[0].detail, /after a proof/);
  assert.equal(cli(sandbox({ doc: `We run ${M("three", "3")} servers. ${proof}\n` }), "--check").status, 0);
});

test("a marker inside an AUTO-GEN block is MISPLACED, even after a row that quotes the markers", () => {
  const block = [
    "<!-- AUTO-GEN:start t -->",
    "| row that quotes <!-- AUTO-GEN:start t --> and <!-- AUTO-GEN:end t --> |",
    `| later row ${M("three", "3")} |`,
    "<!-- AUTO-GEN:end t -->",
    `After it: ${M("three", "3")}.`,
  ].join("\n");
  const r = cli(sandbox({ doc: `${block}\n` }), "--check", "--format=json");
  assert.equal(r.status, 1);
  assert.deepEqual(rows(r).map((x) => [x.line, x.result]), [[3, "MISPLACED"], [5, "OK"]]);
});

test("markers in backticks or fenced code are text, not markers", () => {
  const src = `Write \`${M("three", "7")}\` like this.\n\n\`\`\`md\nWe run ${M("three", "7")}.\n\`\`\`\n\nWe run ${M("three", "3")}.\n`;
  const root = sandbox({ doc: src });
  const r = cli(root, "--check", "--format=json");
  assert.equal(r.status, 0);
  assert.equal(rows(r).length, 1);
  cli(root, "--write");
  assert.equal(doc(root), src);
});

test("an opener with no closer on its line is MALFORMED", () => {
  const r = cli(sandbox({ doc: `We run <!-- live:three -->3\nservers<!-- /live -->.\n` }), "--check", "--format=json");
  assert.equal(r.status, 1);
  assert.ok(rows(r).every((x) => x.result === "MALFORMED" || x.result === "UNUSED"));
});

test("a failing query or an off-format value is exit 3, and --write leaves the file alone", () => {
  const src = `We run ${M("three", "2")} servers.\n`;
  for (const run of ["cat no-such-file", "printf three"]) {
    const root = sandbox({ doc: src, registry: { three: { ...THREE, run } } });
    const r = cli(root, "--write", "--format=json");
    assert.equal(r.status, 3, run);
    assert.equal(rows(r)[0].result, "QUERY_FAILED", run);
    assert.equal(doc(root), src, run);
  }
});

test("a bad registry is a usage error (exit 2) before anything runs", () => {
  const cases = [
    { three: { ...THREE, extra: 1 } },
    { three: { ...THREE, kind: "live" } },
    { three: { ...THREE, format: "float" } },
    { three: { run: "printf 3", kind: "snapshot", format: "int" } },
    { three: { ...THREE, run: "gh api repos/x | wc -l" } },
    { three: { ...THREE, run: "wc -l ~/notes.md" } },
    { three: { ...THREE, run: "git log --oneline | wc -l" } },
  ];
  for (const registry of cases) {
    const r = cli(sandbox({ doc: `We run ${M("three", "3")}.\n`, registry }), "--check");
    assert.equal(r.status, 2, JSON.stringify(registry));
  }
  assert.equal(cli(sandbox({ doc: "x\n", registry: null }), "--check").status, 3, "a missing registry is could-not-check");
});

test("the kind:file gate allows quoted patterns that look like paths", () => {
  assert.deepEqual(checkFileQuery(`git grep -lF 'docs/guide.md' -- . | wc -l`), { ok: true });
  assert.equal(checkFileQuery(`cat /etc/hostname`).ok, false);
});

const HOST = { host: { run: "systemctl list-units | wc -l", kind: "snapshot", format: "int", maxAgeDays: 7 } };
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const day = (iso) => iso.slice(0, 10);
const hostDoc = (span) => `We see ${M("host", span)} units.\n`;

test("with no store (CI), a snapshot span is judged by its own date", () => {
  assert.equal(cli(sandbox({ doc: hostDoc(`5 (measured ${day(ago(2))})`), registry: HOST }), "--check").status, 0);
  const stale = cli(sandbox({ doc: hostDoc(`5 (measured ${day(ago(9))})`), registry: HOST }), "--check", "--format=json");
  assert.equal(stale.status, 1);
  assert.equal(rows(stale)[0].result, "STALE");
  assert.match(rows(stale)[0].detail, /9 days ago, maxAgeDays 7/);
  const undated = cli(sandbox({ doc: hostDoc("5"), registry: HOST }), "--check", "--format=json");
  assert.equal(undated.status, 1);
  assert.equal(rows(undated)[0].result, "MALFORMED");
});

test("with a store, the value must match it and --write fills value and date", () => {
  const measured = ago(1);
  const root = sandbox({ doc: hostDoc("4"), registry: HOST, snapshot: { host: { value: "5", measuredAt: measured } } });
  const check = cli(root, "--check", "--format=json");
  assert.equal(check.status, 1);
  assert.equal(rows(check)[0].result, "DRIFT");
  assert.equal(cli(root, "--write").status, 0);
  assert.equal(doc(root), hostDoc(`5 (measured ${day(measured)})`));
  assert.equal(cli(root, "--check").status, 0);
});

test("--snapshot stores the raw value, so a word-format span renders from it", () => {
  const reg = { n: { run: "printf 5", kind: "snapshot", format: "word", maxAgeDays: 7 } };
  const root = sandbox({ doc: `It has ${M("n", "Four")} routes.\n`, registry: reg });
  assert.equal(cli(root, "--snapshot").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(storeOf(root), "utf8")).n.value, "5");
  assert.equal(cli(root, "--write").status, 0);
  assert.equal(doc(root), `It has ${M("n", `Five (measured ${day(ago(0))})`)} routes.\n`);
  assert.equal(cli(root, "--check").status, 0);
});

test("a same-value span is refreshed only once half its maxAge has passed", () => {
  const fresh = { host: { value: "5", measuredAt: ago(0) } };
  const young = sandbox({ doc: hostDoc(`5 (measured ${day(ago(2))})`), registry: HOST, snapshot: fresh });
  assert.equal(cli(young, "--check").status, 0, "2 of 7 days: no date churn");
  const aging = sandbox({ doc: hostDoc(`5 (measured ${day(ago(4))})`), registry: HOST, snapshot: fresh });
  assert.equal(cli(aging, "--check").status, 1, "4 of 7 days: refresh due");
  cli(aging, "--write");
  assert.equal(doc(aging), hostDoc(`5 (measured ${day(ago(0))})`));
});

test("a store past maxAge is STALE and names the timer; an unreadable store is could-not-check", () => {
  const stale = cli(sandbox({ doc: hostDoc(`5 (measured ${day(ago(8))})`), registry: HOST, snapshot: { host: { value: "5", measuredAt: ago(8) } } }), "--check", "--format=json");
  assert.equal(stale.status, 1);
  assert.match(rows(stale)[0].detail, /8\.0 days old, maxAgeDays 7.*scheduled --snapshot run is behind/);
  const root = sandbox({ doc: hostDoc(`5 (measured ${day(ago(1))})`), registry: HOST });
  fs.writeFileSync(storeOf(root), "{oops");
  assert.equal(cli(root, "--check").status, 3);
});

test("--help and a bad argument write nothing; exactly one mode is required", () => {
  const src = `We run ${M("three", "2")} servers.\n`;
  const root = sandbox({ doc: src });
  const file = path.join(root, "AGENTS.md");
  const before = fs.statSync(file).mtimeMs;
  const help = cli(root, "--help", "--write");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage: /);
  for (const args of [["--wirte"], [], ["--check", "--write"]]) assert.equal(cli(root, ...args).status, 2, args.join(" "));
  assert.equal(doc(root), src);
  assert.equal(fs.statSync(file).mtimeMs, before);
});

test("--list names each entry and where it is shown, without running queries", () => {
  const root = sandbox({ doc: `We run ${M("three", "3")} servers.\n`, registry: { three: { ...THREE, run: "cat no-such-file" } } });
  const r = cli(root, "--list", "--format=json");
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), [{ name: "three", kind: "file", format: "int", uses: ["AGENTS.md:1"] }]);
});

test("scanFile reports 1-based lines and the span's current text", () => {
  assert.deepEqual(
    scanFile(`a\nWe run ${M("x", "4")}.\n`, "f.md").map(({ line, name, value, result }) => ({ line, name, value, result })),
    [{ line: 2, name: "x", value: "4", result: undefined }],
  );
});

test("--snapshot measures snapshot entries into the store, keeps old on failure", () => {
  const reg = {
    good: { run: "printf 7", kind: "snapshot", format: "int", maxAgeDays: 7 },
    bad: { run: "cat no-such-file", kind: "snapshot", format: "int", maxAgeDays: 7 },
  };
  const root = sandbox({ doc: "No markers.\n", registry: reg });
  const r = cli(root, "--snapshot", "--format=json");
  assert.equal(r.status, 1, "one failure => exit 1");
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.measured, ["good"]);
  assert.deepEqual(out.missing, ["bad"]);
  assert.equal(out.failed.length, 1);
  const store = JSON.parse(fs.readFileSync(storeOf(root), "utf8"));
  assert.equal(store.good.value, "7");
  assert.ok(Date.parse(store.good.measuredAt), "measuredAt is a date");
  assert.equal(store.bad, undefined, "a never-measured failure stays absent");
  // Second run: the good query now fails, the old value is kept with its date.
  const reg2 = { good: { ...reg.good, run: "cat no-such-file" } };
  fs.writeFileSync(path.join(root, "live-values.json"), JSON.stringify(reg2));
  const r2 = cli(root, "--snapshot", "--format=json");
  const out2 = JSON.parse(r2.stdout);
  assert.deepEqual(out2.kept, ["good"]);
  const store2 = JSON.parse(fs.readFileSync(storeOf(root), "utf8"));
  assert.equal(store2.good.value, "7", "old value kept");
});

test("--snapshot refuses a bad registry or store with exit 2 and writes nothing", () => {
  const root = sandbox({ doc: "x\n", registry: { bad: { run: "printf 1", kind: "snapshot", format: "int" } } });
  const r = cli(root, "--snapshot");
  assert.equal(r.status, 2, "maxAgeDays missing => usage");
  assert.equal(fs.existsSync(storeOf(root)), false);
  const root2 = sandbox({ doc: "x\n", registry: { good: { run: "printf 1", kind: "snapshot", format: "int", maxAgeDays: 7 } } });
  fs.writeFileSync(storeOf(root2), "{oops");
  assert.equal(cli(root2, "--snapshot").status, 2);
});

test("--snapshot mode is required exactly once, like the other modes", () => {
  const root = sandbox({ doc: "x\n" });
  assert.equal(cli(root, "--snapshot", "--check").status, 2);
  const help = cli(root, "--help");
  assert.match(help.stdout, /--snapshot/);
});

test("storeHealth: silent when kept or when nothing is a snapshot; one line per defect otherwise", () => {
  const reg = { host: HOST.host, other: { ...HOST.host, maxAgeDays: 30 } };
  const at = (days) => ({ value: "5", measuredAt: ago(days) });
  const health = ({ registry = reg, snapshot, timer = true }) => {
    const root = sandbox({ doc: "x\n", registry, snapshot });
    const prev = process.env.LIVE_VALUES_STORE;
    process.env.LIVE_VALUES_STORE = storeOf(root);
    try {
      return storeHealth({ root, timerEnabled: () => timer });
    } finally {
      if (prev === undefined) delete process.env.LIVE_VALUES_STORE;
      else process.env.LIVE_VALUES_STORE = prev;
    }
  };
  assert.deepEqual(health({ snapshot: { host: at(1), other: at(20) } }), [], "within each own maxAge");
  assert.deepEqual(health({ registry: { three: THREE }, timer: false }), [], "no snapshot entry: nothing to keep");
  assert.deepEqual(health({ registry: null, timer: false }), [], "no registry: nothing to keep");
  assert.match(health({ snapshot: { host: at(1), other: at(1) }, timer: false }).join(), /automatic snapshot refresh is NOT enabled/);
  assert.match(health({}).join(), /no snapshot store at/);
  const stale = health({ snapshot: { host: at(9) } });
  assert.equal(stale.length, 1);
  assert.match(stale[0], /host\(9d>7d\) other\(never measured\)/);
});

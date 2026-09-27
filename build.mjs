#!/usr/bin/env node
// Build the portable live-values engine: engine/live-values.mjs and its lib/
// imports bundled into ONE self-contained file, dist/live-values.mjs, which
// each adopting repo copies verbatim to its own scripts/live-values.mjs.
// A copy-identity check (this repo's CI, and each adopter's own gate) keeps
// every copy byte-identical to it.
//
// Why a bundle: the engine source lives here, and another repo's workflow
// cannot check this repo out, so copying five files would be five copies to
// keep identical. Bun 1.3.14 (pinned in .github/workflows/tests.yml) builds
// it byte-identically on every run when invoked from the repo root; the path
// comments it emits are relative to that cwd, so the build always sets it.
//
// Usage:
//   node build.mjs           rebuild the bundle (or: bun build.mjs)
//   node build.mjs --check   is the bundle current?
// Exit: 0 written or current, 1 --check found it stale, 2 usage, 3 could not
// build (bun missing or failed) - never 0 on a build that did not run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./engine/lib/cli-entry.mjs";
import { envRoot } from "./engine/lib/config-root.mjs";

export const DIST = "dist/live-values.mjs";
const HEADER = [
  "// GENERATED from this repo's engine/ by build.mjs.",
  "// Do not edit: change the source in engine/, rebuild with `node build.mjs`, and copy this file again.",
  "// Every adopting repo carries it byte-identical at scripts/live-values.mjs;",
  "// a copy-identity check keeps it so. Usage and the marker grammar: node scripts/live-values.mjs --help.",
].join("\n");

export const build = (root) => {
  const dir = mkdtempSync(join(tmpdir(), "live-values-dist-"));
  try {
    const out = join(dir, "live-values.mjs");
    execFileSync("bun", ["build", "engine/live-values.mjs", "--target=node", "--format=esm", `--outfile=${out}`], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const body = readFileSync(out, "utf8");
    const nl = body.indexOf("\n");
    return body.startsWith("#!") ? `${body.slice(0, nl + 1)}${HEADER}\n${body.slice(nl + 1)}` : `${HEADER}\n${body}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const main = (argv) => {
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length) {
    console.error(`build: unknown argument: ${unknown.join(" ")}\nusage: node build.mjs [--check]`);
    return 2;
  }
  const root = envRoot() ?? fileURLToPath(new URL(".", import.meta.url));
  let fresh;
  try {
    fresh = build(root);
  } catch (err) {
    console.error(`build: could not build: ${String(err.stderr || err.message).trim().split("\n")[0]}`);
    return 3;
  }
  const target = join(root, DIST);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (argv.includes("--check")) {
    if (current === fresh) {
      console.log(`build: ${DIST} is current`);
      return 0;
    }
    console.error(`build: ${DIST} is stale; run node build.mjs and commit it`);
    return 1;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, fresh, { mode: 0o755 });
  console.log(`build: wrote ${DIST}${current === fresh ? " (unchanged)" : ""}`);
  return 0;
};

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));

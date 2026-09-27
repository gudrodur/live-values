// The entry guard (`isMainModule`) exists because `import.meta.url` and
// `process.argv[1]` disagree the moment a script is invoked through a symlinked
// directory: Node reports the module's resolved path while argv[1] keeps the
// spelling the caller typed. On a machine where the checkout was reached
// through a symlinked directory, guarded scripts stopped running their entry
// block — invoked through the alias, a script printed nothing and exited 0,
// which reads exactly like a clean check. These cases pin the resolution
// (both sides, and "cannot resolve" is never a match) and then the real
// thing: a guarded script invoked through a symlinked directory prints what it
// prints by its real path, and exits with the same code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../../engine/lib/cli-entry.mjs';
import { isolatedChildEnv, trackTemp } from './test-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ENGINE = path.join(ROOT, 'engine', 'live-values.mjs');
const BUILD = path.join(ROOT, 'build.mjs');

// A fixed bad-argument run, so the verdict is "usage" (exit 2) with text on
// stderr — never a pass, and nothing here touches a real checkout's docs.
const run = (file, env) => {
  const r = spawnSync(
    process.execPath,
    [file, '--no-such-flag'],
    { encoding: 'utf8', env },
  );
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};

test('this module is the entry point only when argv[1] resolves to it', () => {
  const self = fileURLToPath(import.meta.url);
  assert.equal(isMainModule(import.meta.url, self), true);
  assert.equal(isMainModule(import.meta.url, ENGINE), false);
  assert.equal(isMainModule(import.meta.url, ''), false);
  // The default argument is `process.argv[1]`. Under `node --test` that is this
  // very file, so the guard answers true — which doubles as proof the default is
  // wired to argv and not to a constant.
  assert.equal(isMainModule(import.meta.url), process.argv[1] === self);
  // A path that cannot be resolved is not a match — "could not tell" must never
  // take the same branch as "it is the entry point".
  assert.equal(isMainModule(import.meta.url, path.join(ROOT, 'no-such-file.mjs')), false);
  assert.equal(isMainModule('', self), false);
});

test('a guarded script invoked through a symlinked directory runs its entry block', () => {
  const home = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-entry-')));
  const alias = path.join(home, 'root-alias');
  fs.symlinkSync(ROOT, alias);
  const env = isolatedChildEnv(home);

  const viaAlias = run(path.join(alias, 'engine', 'live-values.mjs'), env);
  const viaReal = run(ENGINE, env);

  // The discriminator: without the fix the alias run printed nothing and exited 0,
  // which is indistinguishable from a clean check.
  assert.notEqual(viaAlias.out.trim(), '', 'invoked through the alias, the script still prints');
  assert.equal(viaAlias.rc, 2, viaAlias.out);
  assert.match(viaAlias.out, /usage: /);
  assert.equal(viaAlias.out, viaReal.out, 'the same script, the same output by both spellings');
  assert.equal(viaAlias.rc, viaReal.rc);
});

// The same defect written a second way — comparing `import.meta.url` against a
// `file://` argv spelling — fails on a symlinked invocation in exactly the
// same place. This case runs the second guarded entry (the builder) both ways
// on an argument it must reject, so the second spelling cannot regress
// unnoticed either.
test('a second guarded entry also runs through a symlinked directory', () => {
  const home = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-entry-build-')));
  const alias = path.join(home, 'root-alias');
  fs.symlinkSync(ROOT, alias);
  const env = isolatedChildEnv(home);

  const viaAlias = run(path.join(alias, 'build.mjs'), env);
  const viaReal = run(BUILD, env);

  assert.notEqual(viaAlias.out.trim(), '', 'invoked through the alias, the builder still prints');
  assert.equal(viaAlias.rc, 2, viaAlias.out);
  assert.match(viaAlias.out, /usage: /);
  assert.equal(viaAlias.out, viaReal.out, 'the same verdict by both spellings');
  assert.equal(viaAlias.rc, viaReal.rc);
});

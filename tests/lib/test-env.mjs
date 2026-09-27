// Test isolation: no test may read or write a real snapshot store or root.
//
// Every scratch run pins its own root and store, so an ambient
// LIVE_VALUES_STORE, LIVE_VALUES_ROOT, CLAUDE_CONFIG_ROOT or AGENT_CONFIG_HOME
// must never leak into a child process: without the strip, all children would
// share one store file. Temp-dir tracking removes each scratch dir when its
// file finishes (best-effort: a test that already deleted its own dir must
// not fail the suite).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

// Pins that route STORE/ROOT state. Timeouts are per-run configuration, not
// state, and travel with the child unchanged.
const ISOLATED_KEYS = new Set([
  'LIVE_VALUES_STORE',
  'LIVE_VALUES_ROOT',
  'CLAUDE_CONFIG_ROOT',
  'AGENT_CONFIG_HOME',
]);

export const isIsolatedKey = (key) => ISOLATED_KEYS.has(key);

const trackedTempDirs = [];
export const trackTemp = (dir) => {
  trackedTempDirs.push(dir);
  return dir;
};

after(() => {
  for (const dir of trackedTempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* already gone or busy: best-effort */ }
  }
});

// A child environment rooted at `home` with no store/root pins: the child
// re-derives the root from its own HOME, and a test that needs a store pins
// an explicit temp path via `extra`.
export const isolatedChildEnv = (home = null, extra = {}) => {
  const dir = home ?? process.env.HOME ?? os.homedir();
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!isIsolatedKey(k)) out[k] = v;
  }
  return {
    ...out,
    HOME: dir,
    ...extra,
  };
};

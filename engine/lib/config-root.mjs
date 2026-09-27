#!/usr/bin/env node
// Root resolution for a live-values checkout: which tree to check.
//
// Order: LIVE_VALUES_ROOT, then CLAUDE_CONFIG_ROOT, then AGENT_CONFIG_HOME
// (both kept as aliases so existing workflows keep working unchanged), then
// the repository that holds this file. An empty pin is ignored, never
// resolved to nowhere. Evaluated at CALL time, never cached at import: tests
// reassign the variables per case, so a cached root would pin the first
// test's answer for the whole process.
//
// The fallback is derived from the caller's own module URL, one directory up:
// engine/live-values.mjs and the dist/live-values.mjs bundle built from it
// both sit exactly one level below the repo root, so either spelling resolves
// to the same tree. Callers pass their `import.meta.url`; the parameter
// default (this file's own URL, two levels below the root) is only for
// callers that already pinned a variable and never reach the fallback.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_ENV_VARS = ['LIVE_VALUES_ROOT', 'CLAUDE_CONFIG_ROOT', 'AGENT_CONFIG_HOME'];

// The first non-empty pin, or null when nothing is pinned.
export const envRoot = () => {
  for (const key of ROOT_ENV_VARS) {
    const v = process.env[key];
    if (v != null && v !== '') return v;
  }
  return null;
};

// The repo root above the module at `metaUrl` (one level up, the layout this
// repo and its bundle share).
export const repoRootOf = (metaUrl) => path.resolve(path.dirname(fileURLToPath(metaUrl)), '..');

// The tree to check: the pin when set, else the caller's repo root.
export const resolveRoot = (metaUrl) => envRoot() ?? repoRootOf(metaUrl ?? import.meta.url);

// Back-compat aliases used by the engine: the root itself, and a join onto it.
// configHome resolves from THIS file's location (two levels below the root),
// so it matches resolveRoot for callers in engine/ and in the bundle.
export const configHome = () => envRoot() ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const configPath = (...segs) => path.join(configHome(), ...segs);

export const configPathFor = (root, ...segs) => path.join(root, ...segs);

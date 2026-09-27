#!/usr/bin/env node
// Tests for the root contract (engine/lib/config-root.mjs): the first
// non-empty pin wins (LIVE_VALUES_ROOT, then CLAUDE_CONFIG_ROOT, then
// AGENT_CONFIG_HOME), otherwise the caller's repo root. Every case pins its
// own variables and restores them; none asserts anything about the ambient
// environment.
// Run: node --test tests/lib/config-root.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configHome, configPath, configPathFor, envRoot, repoRootOf, resolveRoot, ROOT_ENV_VARS } from '../../engine/lib/config-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tests/lib → repo root, two levels up.
const REPO_ROOT = path.resolve(HERE, '..', '..');

let saved;
beforeEach(() => {
  saved = {};
  for (const key of [...ROOT_ENV_VARS, 'HOME']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('envRoot', () => {
  it('is null when nothing is pinned', () => {
    assert.equal(envRoot(), null);
  });

  it('prefers LIVE_VALUES_ROOT over both aliases', () => {
    process.env.LIVE_VALUES_ROOT = '/r/live';
    process.env.CLAUDE_CONFIG_ROOT = '/r/claude';
    process.env.AGENT_CONFIG_HOME = '/r/agent';
    assert.equal(envRoot(), '/r/live');
  });

  it('falls to CLAUDE_CONFIG_ROOT, then AGENT_CONFIG_HOME', () => {
    process.env.CLAUDE_CONFIG_ROOT = '/r/claude';
    process.env.AGENT_CONFIG_HOME = '/r/agent';
    assert.equal(envRoot(), '/r/claude');
    delete process.env.CLAUDE_CONFIG_ROOT;
    assert.equal(envRoot(), '/r/agent');
  });

  it('an empty pin is ignored, not resolved to nowhere', () => {
    process.env.LIVE_VALUES_ROOT = '';
    process.env.CLAUDE_CONFIG_ROOT = '/r/claude';
    assert.equal(envRoot(), '/r/claude');
  });
});

describe('repoRootOf', () => {
  it('resolves one level above the calling module', () => {
    assert.equal(repoRootOf(import.meta.url), path.resolve(HERE, '..'));
    assert.equal(repoRootOf(new URL('../../engine/live-values.mjs', import.meta.url).href), REPO_ROOT);
  });
});

describe('resolveRoot', () => {
  it('returns the pin when set', () => {
    process.env.AGENT_CONFIG_HOME = '/r/agent';
    assert.equal(resolveRoot(import.meta.url), '/r/agent');
  });

  it('defaults to the caller repo root (engine/ and the bundle agree)', () => {
    assert.equal(
      resolveRoot(new URL('../../engine/live-values.mjs', import.meta.url).href),
      REPO_ROOT,
    );
    assert.equal(
      resolveRoot(new URL('../../dist/live-values.mjs', import.meta.url).href),
      REPO_ROOT,
    );
  });
});

describe('configPath', () => {
  it('joins segments onto the resolved root', () => {
    process.env.LIVE_VALUES_ROOT = '/r/live';
    assert.equal(configPath('data', 'live-snapshots.json'), path.join('/r/live', 'data', 'live-snapshots.json'));
  });

  it('falls back to this repo when nothing is pinned', () => {
    assert.equal(configPath('live-values.json'), path.join(REPO_ROOT, 'live-values.json'));
  });
});

describe('configPathFor', () => {
  it('joins segments onto the given root', () => {
    assert.equal(configPathFor('/r/other', 'a', 'b'), path.join('/r/other', 'a', 'b'));
  });
});

describe('configHome', () => {
  it('matches the pin, or this repo unpinned', () => {
    process.env.CLAUDE_CONFIG_ROOT = '/r/claude';
    assert.equal(configHome(), '/r/claude');
    delete process.env.CLAUDE_CONFIG_ROOT;
    assert.equal(configHome(), REPO_ROOT);
  });
});

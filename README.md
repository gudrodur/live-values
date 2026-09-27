# live-values

Computed numbers in prose: a doc carries the value between two markers:

```md
This repo has <!-- live:workflow-count -->six<!-- /live --> workflows.
```

Renderers show only `six`, because both comments are invisible. The registry
`live-values.json` maps each name to the one command that prints its value.
`--check` fails when a span disagrees with its source; `--write` rewrites the
drifted spans; `--hook` rewrites and stages the files for pre-commit.

## This repo checks itself

The engine is <!-- live:engine-lines -->1203<!-- /live --> lines in `engine/`,
covered by <!-- live:test-files -->5<!-- /live --> test files under `tests/`.
CI runs `node dist/live-values.mjs --check` over this repo's docs on every push.

## Adopting

1. Copy the bundle byte-identical: `dist/live-values.mjs` → your repo's
   `scripts/live-values.mjs` (then `chmod 755`).
2. Copy `workflow/live-values.yml` → your repo's `.github/workflows/live-values.yml`.
3. Write `live-values.json` entries of `kind: file` only: allowlisted tools, no
   absolute paths, no git history.
4. Place markers (`<!-- live:NAME -->N<!-- /live -->`, never a line's first
   token) and run `node scripts/live-values.mjs --check` (rc 0), then perturb
   a source, expect drift with rc 1, and restore.
5. Add a pre-commit step running `node scripts/live-values.mjs --hook`.

The full procedure (worktrees, tooling ignores, CI lanes, acceptance) is in
`adopt/SKILL.md`. The marker grammar is in `docs/grammar.md`, and in the
engine header (`node dist/live-values.mjs --help` here; `node scripts/live-values.mjs --help` in an adopting repo).

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `LIVE_VALUES_ROOT` | the checkout holding the script | Which tree to check |
| `CLAUDE_CONFIG_ROOT` | — | Alias of `LIVE_VALUES_ROOT` (existing workflows keep working) |
| `AGENT_CONFIG_HOME` | — | Alias of `LIVE_VALUES_ROOT` (existing workflows keep working) |
| `LIVE_VALUES_STORE` | `<root>/data/live-snapshots.json` | Where `--snapshot` measures `kind: snapshot` entries |
| `LIVE_VALUES_TIMEOUT_MS` | `10000` | Per-query timeout for `--check` / `--write` / `--hook` |
| `LIVE_VALUES_SNAPSHOT_TIMEOUT_MS` | `60000` | Per-query timeout for `--snapshot` |

Unset means "the repo I'm in". `kind: file` entries never touch the store;
`kind: snapshot` entries need a scheduled daily `--snapshot` run wherever the
store lives (`--store-health` reports whether it is being kept).

## Requirements

Node 24 to run the engine and the tests (`npm test`). Bun 1.3.14 only to
rebuild the bundle (`npm run build`, i.e. `bun build.mjs`); the committed
`dist/live-values.mjs` is byte-identical on every build, and
`node build.mjs --check` enforces it in CI.

## License

MIT — see `LICENSE`.

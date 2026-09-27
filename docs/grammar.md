# The live marker grammar

A number or list in the prose is computed from its source, not typed. The doc
carries the value between two HTML comments that name it:

```md
This repo has <!-- live:workflow-count -->six<!-- /live --> workflows.
```

Renderers show only `six`, because both comments are invisible. The registry,
`live-values.json` at the repo root, maps each name to the one command that
prints its value:

```json
{ "workflow-count": { "run": "ls .github/workflows/*.yml | wc -l", "kind": "file", "format": "word" } }
```

`kind: file` values are computed from the checkout alone, on a CI runner with
no auth. Every command in the query must be allowlisted; there are no absolute
or `~` paths, and no git history (CI clones shallow). `kind: snapshot` values
come from a machine, an account or the network: `--snapshot` (run daily by a
scheduler) measures them into a store file, `data/live-snapshots.json` beside
the registry (`LIVE_VALUES_STORE` overrides), as `{ NAME: { value,
measuredAt } }`. A snapshot span carries its own date:

```md
The fleet runs <!-- live:runners -->5 (measured 2026-09-26)<!-- /live --> runners.
```

so CI, which has no store, still checks it: the span's date must be within
`maxAgeDays`. Where the store exists, the value must also equal it, and
`--write` refreshes the date once half the window has passed — a bounded churn
of one date edit per half-window, not one per day.

Formats: `int` (digits), `word` (0–20 spelled out, keeping the span's
capitalisation), `text` (the query's one line, verbatim).

## Commands

- `--check`: read-only verdict. Exit 0 every span equals its value; 1 drift,
  unknown, unused, stale, malformed or misplaced; 2 bad argument or registry;
  3 could not check.
- `--write`: rewrite drifted spans from their sources (atomic, per file).
- `--hook`: pre-commit mode — `--write`, then `git add` exactly the rewritten
  files. Refuses a file with unstaged changes, because staging would sweep
  someone else's half-done edit into the commit. A query that cannot run here
  never blocks the commit; a marker error does.

## Placement rules

- Never the first token of a line (after any list or quote marker). A line
  that opens with `<!--` starts an HTML block, and the rest of the line then
  renders with no markdown.
- Never after a `<!-- proof: … -->` comment on the same line: a proof reader
  takes the line to the last `-->`, so the proof would parse as bad JSON.
- Never inside an `AUTO-GEN` block, whose lines a generator owns.
- One line per marker, no nesting. Markers inside fenced code or backticks are
  text, so a doc can show the grammar — like this one does.

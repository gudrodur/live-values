---
name: live-values-adopt
description: "Adopt live values (live markers + registry + CI check) in another repo, or re-copy the bundle"
---

# Adopt live values in a repo

The source of truth is the `live-values` repo: a generated bundle (`node build.mjs`) plus a workflow. The marker grammar lives in `docs/grammar.md` (and in the engine header: `node scripts/live-values.mjs --help`).

## 1. Decide first
- Adopt only if a tracked doc states a count that **this repo's checkout** can compute: a registry length, a file-glob count, or a list in code.
- Skip dated history, facts about another repo, runtime or server data, and counts with an unclear definition. An empty registry is an empty-evidence pass.
- Scope is root `CLAUDE.md`, `AGENTS.md` and `README.md`, `docs/**/*.md`, and `(.claude/)skills/*/SKILL.md`, tracked files only. A marker inside a code fence is plain text, so move the count into prose.

## 2. Copy the two files byte-identical
- `gh api repos/<owner>/live-values/contents/dist/live-values.mjs --jq .content | base64 -d > scripts/live-values.mjs` (then `chmod 755`);
- the same command for `workflow/live-values.yml`, into `.github/workflows/live-values.yml`.
- Check the copies against the release (byte-compare), not just by eye.
- Write `live-values.json` entries of `kind: file` only. The query must use allowlisted tools, no absolute paths and no git history.
- Place markers: `<!-- live:NAME -->N<!-- /live -->`. A marker is never a line's first token (after list markers); `**` directly before it is fine.

## 3. Exclude the bundle from local tooling
Add `scripts/live-values.mjs` to:
- the linter ignore (e.g. the `ignorePatterns` of the repo's linter);
- the formatter ignore, if a hook rewrites sources on commit;
- the unused-code checker's ignore, because it flags the bundle's scheduler probe.

A local fix makes the copy differ from the release, and the copy-identity check fails it.

## 4. Hook
- Hook-runner repos: add a pre-commit command, `live-values: run: node scripts/live-values.mjs --hook`.
- Hand-written `git-hooks/`: add a step that runs the same command.

## 5. Verify, both ways
- `node scripts/live-values.mjs --check` must be rc 0.
- Then perturb the source (add a probe entry or file), expect `DRIFT … N → N+1` with rc 1, and restore.
- Run the repo's lint, format and unused-code checks.

## 6. CI
- The workflow needs no secrets. Its runner is the `GUARD_RUNNER_LABELS` repository variable, default `ubuntu-slim` (GitHub's hosted single-CPU runner, enough for this job); a repo that cannot use hosted runners sets it to its self-hosted labels (never on a public repo).
- A private repo in a free org stays advisory (no rulesets). On a paid repo the check can be made required.
- A job lasting about 2 s with no steps is a runner billing block, not code. Read the job annotation.

## 7. Acceptance
- After merge, the copy-identity check shows no findings for the repo.
- Positive control: the check must flag a one-byte-off copy.

## Bundle changes
Change the source in the `live-values` repo's `engine/`, run `node build.mjs` (the CI gate `--check` enforces it), release, then re-copy into each adopter. For a single file, commit it through the contents API (`gh api -X PUT .../contents/<path>`), so no hooks run and none are skipped.

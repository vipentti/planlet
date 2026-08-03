# Release-cut maintainer utility

## Summary

Add a dependency-free maintainer script that collapses the still-manual
release-cut operator steps from `RELEASING.md` into two explicit subcommands:
`prepare` (changelog cut, version alignment, signed release commit, branch push,
and PR into `main`) and `tag` (annotated signed tag, optional push). Remote
publish stays with environment-gated `release.yml`. No auto-merge and no
auto-tag after merge.

## Motivation

After release automation, humans still hand-edit release files, remember
`--release-date`, open the version PR, create a signed annotated tag, and push
it. Mistakes fail late in the workflow. A local script can make prepare and tag
deterministic and fail closed before irreversible remote publish, while keeping
PR review and the post-merge tag as deliberate human gates.

## Scope

In scope:

- New `scripts/release.mjs` (Node 22+, no new runtime deps) with subcommands
  `prepare` and `tag`.
- npm aliases only:
  - `release:prepare` → `node scripts/release.mjs prepare`
  - `release:tag` → `node scripts/release.mjs tag`
- `prepare`: for required `--version`, cut changelog; align `package.json` and
  root `package-lock.json` version fields; create branch `release/v<version>`;
  create a signed commit (`git commit -S`) with message `release: <version>`
  containing only those release files; push the branch to `origin`; open a PR
  into `main` via `gh pr create` (no auto-merge).
- `tag`: require clean worktree, `HEAD` ancestor of fetched `origin/main`,
  `package.json` version equals `--version`, create annotated signed
  `git tag -a -s`; optional `--push` pushes only that tag.
- Dry-run by default on both subcommands; mutations require `--execute`.
  `--push` is valid only on `tag` and still requires `--execute`. Prepare has
  no separate `--push`; network steps are part of `prepare --execute`.
- Gate on existing `scripts/assert-changelog-release-ready.mjs --release-date`
  (default date: today UTC); smoke notes via `scripts/changelog.mjs`.
- Update `RELEASING.md` for the scripted operator path; leave workflow /
  trusted-publishing narrative authoritative for the remote job.
- Subprocess / fixture tests for cut, alignment, refusals, and dry-run vs
  execute. Live `gh`/remote push are operator gates; CI must not require them
  for green.

Out of scope:

- A single `npm run release` that mixes phases.
- `planlet release` or any product-CLI / skill / planlet-lifecycle change.
- Changing `.github/workflows/release.yml`, Environment `release`, tag rulesets,
  or npm trusted publishing.
- Auto-merge of the version PR.
- Auto-tag immediately after PR merge (tag remains a separate post-merge step).
- Version selection / semver inference, changelog prose generation, prerelease
  channels, or direct `npm publish`.
- Force-updating, moving, or deleting tags or release branches.

## Approach

### Operator workflow

1. On a clean checkout at `origin/main`:
   `npm run release:prepare -- --version X.Y.Z` (dry-run), then `--execute`.
2. Human reviews and merges the opened PR into `main` (no auto-merge).
3. On a clean checkout at that main-reachable merge commit:
   `npm run release:tag -- --version X.Y.Z --execute`, optionally with `--push`
   on the same invocation.

### `prepare`

1. Require a clean worktree before any edits so unrelated dirt cannot enter the
   release commit.
2. Require fetched `HEAD` equals `origin/main` so the PR contains only the
   release commit.
3. Dry-run: print intended file edits, branch name, signed commit, push, and
   `gh pr create` actions; run read-only prechecks that can run without
   mutating; exit non-zero when checks would fail.
4. `--execute`: cut `[Unreleased]` into `## [<version>] - <date>`, restore empty
   Unreleased, update compare/footer links, set package/lock versions, run
   assert `--release-date` and smoke `changelog.mjs <version>`.
5. Create branch `release/v<version>` from that HEAD, stage only the release
   files, `git commit -S -m "release: <version>"`, `git push -u origin` that
   branch, then `gh pr create` into `main` with a short title/body summarizing
   the version cut and a light pointer to `RELEASING.md` / review checklist.
6. Fail closed when: signing unavailable or soft-fails; `gh` missing or
   unauthenticated; branch or PR for this release already exists; worktree not
   clean; `HEAD` ≠ `origin/main`; Unreleased empty when a new section is
   required; assert fails.

### `tag`

1. Shared flags: required `--version`, optional `--release-date` (default today
   UTC), `--execute`, `--help`. Tag-only: `--push`.
2. `--execute`: clean worktree; `HEAD` reachable from fetched `origin/main`;
   `package.json` version equals `--version`; no colliding local tag; assert
   with `--release-date`; `git tag -a -s "v<version>" -m "v<version>"` at
   `HEAD`. With `--push`, `git push origin refs/tags/v<version>` only.
3. Fail closed on past `--release-date`, empty notes, version/tag mismatch,
   dirty tree, SHA not on `origin/main`, unsigned/lightweight tag, force/delete
   tag, `--push` without `--execute` or on `prepare`, any npm publish attempt.

### Shared

Preserve `--release-date` semantics and duplicate-flag hardening from
`AGENTS.md` by calling the assert script as a subprocess. Document the
prepare → review/merge → tag[`--push`] flow in `RELEASING.md`.

## Acceptance Criteria

- `release:prepare` / `release:tag` dry-run perform no file, git, or network
  mutations and report the actions they would take.
- `prepare --execute` cuts changelog, aligns package/lock versions, creates
  signed commit `release: <version>` on branch `release/v<version>`, pushes that
  branch, and opens a non-merging PR into `main` via `gh`.
- `prepare` never merges the PR, never creates a release tag, and never publishes
  to npm.
- `tag --execute` on a clean, main-reachable commit matching `--version` creates
  only an annotated signed `v<version>` tag; signing failure leaves no
  lightweight tag.
- Tag push happens only with `--push` together with `--execute` on `tag`.
- Script refuses the hard-refusal cases listed in Approach.
- `RELEASING.md` documents prepare → review/merge → tag[`--push`]; remote job
  behavior unchanged.
- Automated tests cover cut, assert integration, dry-run purity, and refusals
  without requiring live GitHub/npm; operator-only steps are documented as such.

## Verification

Strategy only — run results stay in the test suite, review, and CI:

```sh
npm run format:check
npm run lint
npm run type-check
npm run build
npm test
git diff --check
```

Also run focused subprocess/fixture cases for `scripts/release.mjs`. Live
signed commit, `gh pr create`, signed tag, and `git push` against
`vipentti/planlet` are operator gates outside CI; dry-run and refusal tests must
still prove the safe defaults. No `## Verification Evidence` section expected
unless an irreversible external proof is later required.

## Risks and Considerations

- Prepare now performs network git/GitHub mutations under `--execute`; dry-run
  default and fail-closed prechecks are load-bearing.
- Commit and tag signing depend on the operator’s local git SSH/GPG setup; CI
  cannot fully prove GitHub verification for laptop-created objects.
- A successful tag push still waits on Environment `release` reviewers; the
  script must not claim npm/GitHub release success.
- Changelog cut cannot invent prose; empty Unreleased must fail.
- Requiring `HEAD == origin/main` for prepare avoids sweeping unrelated local
  commits into the version PR; operators must update main first.

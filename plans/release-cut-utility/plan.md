# Release-cut maintainer utility

## Summary

Add a dependency-free maintainer script that collapses the still-manual
release-cut operator steps from `RELEASING.md` into two explicit subcommands:
`prepare` (changelog cut, version alignment, signed release commit, branch push,
and PR into `main`) and `tag` (annotated signed tag, optional push). Remote
publish stays with environment-gated `release.yml`. No auto-merge and no
auto-tag after merge. Dry-run stays strictly non-mutating; `prepare --execute`
is safely resumable after partial success; `tag` derives its release date from
the changelog so delayed merges do not require remembering prepare-time state.

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
  into `main` via `gh pr create` (no auto-merge). Idempotent / resumable when a
  prior attempt left a matching remote branch without a PR.
- `tag`: require clean worktree; validate `HEAD` against current remote `main`
  tip; require `package.json` version equals `--version`; refuse local and
  remote tag collisions via exact-ref `git ls-remote`; create annotated signed
  `git tag -a -s`; optional `--push` pushes only that tag. Default release date
  is read from the matching changelog version section (not “today”).
- Dry-run by default on both subcommands; mutations require `--execute`.
  `--push` is valid only on `tag` and still requires `--execute`. Prepare has
  no separate `--push`; network write steps are part of `prepare --execute`.
- Gate on existing `scripts/assert-changelog-release-ready.mjs --release-date`
  without reimplementing its rules; smoke notes via `scripts/changelog.mjs`.
- Update `RELEASING.md` for the scripted operator path; leave workflow /
  trusted-publishing narrative authoritative for the remote job.
- Fixture / subprocess tests (temp repos, bare local remotes, stubbed `gh`) for
  cut, alignment, dry-run purity, recovery, remote tag collision, and refusals.
  CI must not require live GitHub or real signing keys.

Out of scope:

- A single `npm run release` that mixes phases.
- `planlet release` or any product-CLI / skill / planlet-lifecycle change.
- Changing `.github/workflows/release.yml`, Environment `release`, tag rulesets,
  or npm trusted publishing.
- Auto-merge of the version PR.
- Auto-tag immediately after PR merge (tag remains a separate post-merge step).
- Version selection / semver inference, changelog prose generation, prerelease
  channels, or direct `npm publish`.
- Force-updating, moving, or deleting tags or release branches (including
  automatic cleanup of partial attempts).
- New runtime dependencies.

## Approach

### Operator workflow

1. On a clean checkout whose `HEAD` SHA equals the current remote `main` tip
   (queried without mutating local refs in dry-run):
   `npm run release:prepare -- --version X.Y.Z` (dry-run), then `--execute`.
2. Human reviews and merges the opened PR into `main` (no auto-merge). Merge
   may land on a later UTC day than prepare.
3. On a clean checkout at that main-reachable merge commit:
   `npm run release:tag -- --version X.Y.Z --execute`, optionally with `--push`
   on the same invocation. No remembered prepare-time date is required.

### Shared CLI rules

1. Parse subcommand first (`prepare` | `tag`). Shared flags: required
   `--version`, optional `--release-date`, `--execute`, `--help`. Tag-only:
   `--push`. Reject unknown flags and duplicate flag values consistently (same
   hardening spirit as the assert script’s duplicate-flag pre-scan).
2. Never run `npm publish`, merge a PR, create a release tag during `prepare`,
   or perform any worktree / index / remote-write / local-ref-write mutation
   during dry-run.
3. Subprocess failures must name the failed operation and include enough stderr
   context for recovery without echoing credentials or tokens.
4. Reuse `scripts/assert-changelog-release-ready.mjs` and `scripts/changelog.mjs`
   as subprocesses; do not fork their validation semantics.

### Mutation classes (dry-run contract)

Distinguish four classes of operations:

| Class | Examples | Dry-run | `--execute` |
| --- | --- | --- | --- |
| Remote read-only | `git ls-remote`, `gh` read APIs | Allowed | Allowed |
| Local Git metadata mutation | `git fetch` (updates remote-tracking refs / objects), writing `FETCH_HEAD` | Forbidden | Allowed when required; prefer `--no-write-fetch-head` where useful, acknowledging objects/refs may still update |
| Worktree / index mutation | editing files, `git add`, `git commit`, creating local branches/tags | Forbidden | Allowed for the subcommand’s intended steps |
| Remote mutation | `git push`, `gh pr create` | Forbidden | Allowed for the subcommand’s intended steps |

Dry-run acceptance is mechanically testable: after a dry-run, worktree, index,
local refs (including remote-tracking refs), and remotes are unchanged aside
from process-ephemeral state outside the repo.

### Remote `main` identity without false validation

- **Dry-run:** obtain remote `main` SHA via
  `git ls-remote origin refs/heads/main` (remote read-only). For `prepare`,
  require local `HEAD` equals that SHA. For `tag`, if the remote tip object is
  not available locally, do **not** claim ancestry success; report that full
  ancestry validation requires `--execute` (which will fetch) and exit
  non-zero when ancestry cannot be proven, or succeed only when ancestry can
  already be proven from objects present locally against the ls-remote SHA.
- **`--execute`:** explicitly `git fetch` (with `--no-write-fetch-head` where
  useful) before mutations, then validate against the fetched result:
  `prepare` requires `HEAD == origin/main` tip; `tag` requires `HEAD` is an
  ancestor of that tip (reachable from remote `main`).

### Release-date resolution

- **`prepare`:** `--release-date` defaults to today UTC. That date is written
  into the new changelog section `## [<version>] - <date>`. Assert is invoked
  with that same date. Past dates remain refused by the existing assert
  semantics (do not weaken them).
- **`tag`:** do **not** default `--release-date` to today. By default, parse
  the date from the matching dated changelog section for `--version`. If the
  operator supplies `--release-date`, it must exactly equal that changelog
  date; otherwise refuse. Always invoke
  `assert-changelog-release-ready.mjs --release-date <resolved-date>` with the
  resolved changelog date. Primary docs use
  `npm run release:tag -- --version X.Y.Z --execute` with no hidden date
  state. Tests must cover tagging on a UTC day later than prepare.

### `prepare` prechecks (before any file edits)

Run all non-mutating prerequisite checks first, on both dry-run and execute:

1. Clean worktree (no unrelated dirt).
2. `--version` / `--release-date` shape validation.
3. Remote `main` identity as above; local `HEAD` must equal remote `main` tip.
4. Local and remote branch collision discovery for `release/v<version>`
   (local branch inspect + `git ls-remote` for the exact branch ref).
5. Existing PR lookup via `gh` (read-only) for head `release/v<version>` into
   `main`.
6. `gh` availability and authentication checks that are safe to run read-only.
7. Signing configuration checks that can be performed without creating a
   commit or tag (fail closed if signing cannot be used).

Only after prechecks pass may `--execute` edit files.

### `prepare` expected release commit and recovery state machine

Define the **expected release commit** as the unique signed commit that would
result from the file edits + `git commit -S -m "release: <version>"` with only
the release files (`CHANGELOG.md`, `package.json`, root `package-lock.json`).

Phases and recovery (never delete or force-update branches automatically):

| Failure point | Left behind | Rerun behavior |
| --- | --- | --- |
| During file edits (before commit) | Dirty / partial files | Refuse if worktree dirty; operator restores clean tree manually. No automatic reset. |
| After commit, before push | Local branch at expected commit | Resume: push branch, then ensure PR. |
| After successful push, before/during `gh pr create` | Remote branch at expected commit, no PR | Resume: skip recreating commit/push content; only create the missing PR. |
| PR already exists for expected head | Matching open (or relevant) PR | Report existing PR URL; do not create a duplicate; exit success (or dedicated non-error “already complete” status). |
| Local or remote branch exists but tip ≠ expected release commit | Divergent history | Hard refuse; require deliberate manual investigation. |
| Existing PR whose head commit ≠ expected | Conflicting PR | Hard refuse. |
| Unsafe collision (unrelated same-name branch/PR) | Foreign state | Hard refuse. Do not overwrite. |

Idempotent success path when remote `release/v<version>` already points at the
exact expected signed release commit and no conflicting PR exists: allow
retrying PR creation only. Refuse solely-on-exists is incorrect; inspect the
commit.

`prepare --execute` success means: release files committed as expected, branch
pushed, and a non-merging PR into `main` exists (created now or already
present and matching).

### `tag`

1. Prechecks: clean worktree; version match; resolve release date from
   changelog (optional explicit `--release-date` must match); run assert with
   resolved date; smoke notes as appropriate; remote `main` ancestry per
   mutation-class rules above.
2. **Remote tag collision (dry-run and execute):** query the exact remote tag
   ref without mutating it, e.g.
   `git ls-remote --exit-code --tags origin refs/tags/v<version>`.
   Refuse if that exact tag name already exists remotely. Do not rely on the
   local tag namespace or a possibly stale fetch. Match the exact tag name
   (handle peeled annotated-tag refs carefully; do not treat similarly
   prefixed tags as collisions). Also refuse if the tag already exists
   locally.
3. Do **not** create a local tag and discover collision only at `git push`.
4. Recreating a previously deleted release tag is **always refused** by
   default when the remote still has the tag, and if history/investigation
   shows a prior release under that version the safe default remains refuse
   and require deliberate manual investigation — the script never
   force-moves or deletes tags.
5. `--execute`: create `git tag -a -s "v<version>" -m "v<version>"` at `HEAD`.
   With `--push`, `git push origin refs/tags/v<version>` only. Signing
   failure must leave no lightweight tag.
6. Refuse: past resolved dates per assert, empty notes, version/tag mismatch,
   dirty tree, SHA not on remote `main`, unsigned/lightweight tag,
   force/delete tag operations, `--push` without `--execute` or on
   `prepare`, any npm publish attempt.

### Documentation

Update `RELEASING.md` for prepare → review/merge → tag[`--push`], including:

- that `tag` reads the changelog date automatically;
- that prepare may be safely re-run to finish PR creation after a successful
  push;
- that dry-run uses remote read-only queries and does not fetch.

## Acceptance Criteria

- `release:prepare` / `release:tag` dry-run perform no worktree/index
  mutations, no local Git metadata mutations (including no `git fetch`), and
  no remote mutations; they may use remote read-only queries. Guarantees are
  covered by mechanical tests.
- Dry-run never falsely reports successful `main` ancestry/identity when that
  fact cannot be proven without a fetch; execute fetches explicitly before
  mutating.
- `prepare` defaults `--release-date` to today UTC; `tag` defaults by reading
  the matching changelog section date; explicit `tag --release-date` must
  match that section; assert is always called with the resolved date and its
  semantics are not weakened. Documented tag command needs no remembered
  prepare date; tests cover tag on a later UTC day than prepare.
- `prepare --execute` cuts changelog, aligns package/lock versions, creates
  signed commit `release: <version>` on branch `release/v<version>`, pushes
  that branch, and ensures a non-merging PR into `main` via `gh`.
- After push succeeds and PR creation fails, a rerun that finds the remote
  branch at the exact expected release commit creates the missing PR and does
  not duplicate commits or force-update the branch.
- Same-name local/remote branch or PR pointing elsewhere is refused without
  automatic delete/force-update.
- An existing matching PR is reported without creating a duplicate.
- `prepare` never merges the PR, never creates a release tag, and never
  publishes to npm.
- `tag` refuses when the exact remote tag ref already exists (verified via
  `ls-remote` before local tag creation), including remote-only collisions in
  fixture tests; never force-moves or deletes tags.
- `tag --execute` on a clean, main-reachable commit matching `--version`
  creates only an annotated signed `v<version>` tag; signing failure leaves no
  lightweight tag.
- Tag push happens only with `--push` together with `--execute` on `tag`.
- Flags are parsed strictly; duplicate values are rejected; subprocess errors
  include operation + stderr context without credentials.
- `RELEASING.md` documents the operator path above; remote job behavior
  unchanged.
- Automated tests use fixture repos and bare local remotes; CI does not
  require live GitHub/npm or real signing keys for green.

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

Also run focused subprocess/fixture cases for `scripts/release.mjs`, including
dry-run purity (no ref/worktree drift), prepare recovery after push-without-PR,
divergent-branch refusal, matching-PR idempotence, remote-only tag collision,
and tag-after-later-UTC-day prepare. Live signed commit, real `gh`, signed
tag, and `git push` against `vipentti/planlet` remain operator gates outside
CI. No `## Verification Evidence` section expected unless an irreversible
external proof is later required.

## Risks and Considerations

- Prepare performs network git/GitHub mutations under `--execute`; dry-run
  default, prechecks-before-edits, and an explicit recovery state machine are
  load-bearing so “fail closed” does not strand a pushed branch without a PR.
- Commit and tag signing depend on the operator’s local git SSH/GPG setup; CI
  cannot fully prove GitHub verification for laptop-created objects and must
  stub signing paths.
- A successful tag push still waits on Environment `release` reviewers; the
  script must not claim npm/GitHub release success.
- Changelog cut cannot invent prose; empty Unreleased must fail.
- Requiring `HEAD` equal to the current remote `main` tip for prepare avoids
  sweeping unrelated local commits into the version PR; operators must update
  to current main first.
- Reading the tag release date from the changelog removes cross-day operator
  footguns without weakening assert’s date equality rules.
- `git ls-remote` / `gh` read calls need network even in dry-run; that is
  intentional and distinct from Git metadata or remote-write mutations.

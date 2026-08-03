# Release-cut maintainer utility

## Summary

Add a dependency-free maintainer script that collapses the still-manual
release-cut operator steps from `RELEASING.md` into two explicit subcommands:
`prepare` (changelog cut, version alignment, signed release commit, branch push,
and PR into `main`) and `tag` (annotated signed tag, optional push). Remote
publish stays with environment-gated `release.yml`. No auto-merge and no
auto-tag after merge.

Dry-run stays strictly non-mutating. `prepare` selects **fresh** vs **resume**
mode before applying fresh-only checks, and resumes by validating an existing
release commit against explicit invariants (never by predicting a commit SHA).
`tag` requires `HEAD` equal to the current remote `main` tip and verifies the
already-prepared changelog date through a new historical assert mode so delayed
merges work without weakening prepare-time date rules.

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
- Narrow extension of
  `scripts/assert-changelog-release-ready.mjs` with a historical verification
  mode (e.g. `--verify-release-date YYYY-MM-DD`) that validates an
  already-prepared version section without requiring the date to be today or
  later. Existing `--release-date` prepare-time semantics (including
  not-in-the-past) stay unchanged.
- `prepare` fresh mode: cut changelog; align `package.json` and root
  `package-lock.json`; create branch `release/v<version>`; signed commit
  `release: <version>` with only those release files; push; `gh pr create`
  into `main` (no auto-merge).
- `prepare` resume mode: discover existing release branch / PR state first;
  validate the existing release commit against invariants; finish push and/or
  PR creation without recreating the commit.
- `tag`: require clean worktree and `HEAD ==` current remote `main` tip;
  `package.json` version equals `--version`; refuse local and remote tag
  collisions via exact-ref `git ls-remote`; create annotated signed
  `git tag -a -s`; optional `--push`. Release date is read from the changelog
  and verified with `--verify-release-date` (not `--release-date`).
- Dry-run by default; mutations require `--execute`. `--push` is valid only on
  `tag` and still requires `--execute`. Prepare has no separate `--push`.
- Reuse assert and `scripts/changelog.mjs` as subprocesses; do not reimplement
  changelog parsing/validation inside `release.mjs`.
- Update `RELEASING.md` for the scripted operator path; leave workflow /
  trusted-publishing narrative authoritative for the remote job.
- Fixture / subprocess tests (temp repos, bare remotes, stubbed `gh` /
  signing). CI must not require live GitHub or real signing keys.

Out of scope:

- A single `npm run release` that mixes phases.
- `planlet release` or any product-CLI / skill / planlet-lifecycle change.
- Changing `.github/workflows/release.yml`, Environment `release`, tag rulesets,
  or npm trusted publishing.
- Auto-merge of the version PR.
- Auto-tag immediately after PR merge.
- Version selection / semver inference, changelog prose generation, prerelease
  channels, or direct `npm publish`.
- Force-updating, moving, or deleting tags or release branches.
- New runtime dependencies.
- Predicting or regenerating a release commit SHA for idempotency.

## Approach

### Operator workflow

1. Fresh prepare on a clean checkout at the current remote `main` tip:
   `npm run release:prepare -- --version X.Y.Z` (dry-run), then `--execute`.
2. Human reviews and merges the opened PR into `main` (no auto-merge). Merge
   may land on a later UTC day than prepare.
3. After merge, on a clean checkout updated so `HEAD` equals the current remote
   `main` tip (the merge result):
   `npm run release:tag -- --version X.Y.Z --execute`, optionally with `--push`.
   No remembered prepare-time date is required.

### Shared CLI rules

1. Parse subcommand first (`prepare` | `tag`). Shared flags: required
   `--version`, optional `--release-date` (prepare only for cutting; on `tag`
   optional override that must match the changelog), `--execute`, `--help`.
   Tag-only: `--push`. Reject unknown flags and duplicate values consistently.
2. Never run `npm publish`, merge a PR, create a release tag during `prepare`,
   or perform worktree / index / remote-write / local-ref-write mutations during
   dry-run.
3. Subprocess failures name the failed operation and include enough stderr for
   recovery without echoing credentials.
4. Call assert / changelog helpers as subprocesses; do not duplicate their
   validation rules in `release.mjs`.

### Mutation classes (dry-run contract)

| Class | Examples | Dry-run | `--execute` |
| --- | --- | --- | --- |
| Remote read-only | `git ls-remote`, `gh` read APIs | Allowed | Allowed |
| Local Git metadata mutation | `git fetch`, writing `FETCH_HEAD` | Forbidden | Allowed when required; prefer `--no-write-fetch-head` where useful |
| Worktree / index mutation | editing files, `git add` / `commit`, creating local branches/tags | Forbidden | Allowed for intended steps |
| Remote mutation | `git push`, `gh pr create` | Forbidden | Allowed for intended steps |

Dry-run acceptance is mechanically testable: after dry-run, worktree, index,
and local refs (including remote-tracking refs) are unchanged aside from
process-ephemeral state outside the repo.

### Remote `main` identity without false validation

- **Dry-run:** obtain remote `main` SHA via
  `git ls-remote origin refs/heads/main`. Compare local SHAs to that value
  without `git fetch`. If a required object is missing locally and identity
  cannot be proven, do not claim success — report that `--execute` must fetch
  and exit non-zero (or only succeed when the comparison is already provable).
- **`--execute`:** explicitly `git fetch` before mutations, then validate
  against the fetched tip.

### Assert helper: prepare vs historical verify

Extend `scripts/assert-changelog-release-ready.mjs` (dependency-free, same
Node range) with a clearly named historical mode, e.g.
`--verify-release-date YYYY-MM-DD`, mutually exclusive with `--release-date`.

| Mode | Used by | Checks | Not-in-the-past? |
| --- | --- | --- | --- |
| (default / CI) | existing ordinary CI | unchanged | N/A (existing behavior) |
| `--release-date D` | `prepare` | unchanged: Unreleased + matching version section dated `D`, non-empty notes, `D` today-or-later UTC, date equality | Yes — preserve |
| `--verify-release-date D` | `tag` | exactly one empty Unreleased; exactly one matching package-version section; valid calendar date; non-empty notes; section date equals `D` | **No** — historical OK |

Do not weaken `--release-date`. Do not reimplement these rules inside
`release.mjs`. Document both flags in script usage / `RELEASING.md` as needed.
Tests for the helper itself:

- `--release-date` still rejects a past date;
- `--verify-release-date` accepts a valid earlier-day changelog section for the
  current package version;
- `--verify-release-date` rejects mismatch between `D` and the changelog date.

### Release-date resolution in `release.mjs`

- **`prepare`:** `--release-date` defaults to today UTC; write that date into
  the new section; invoke assert with `--release-date <D>` (strict).
- **`tag`:** derive `D` from the matching changelog version section. If the
  operator supplies `--release-date`, it must equal that section date or
  refuse. Invoke assert with `--verify-release-date <D>` (historical). Primary
  docs: `npm run release:tag -- --version X.Y.Z --execute` with no hidden date.

### `prepare` mode selection (before fresh-only checks)

Before applying fresh-run requirements, discover whether release state already
exists for `--version`:

1. Inspect local ref `refs/heads/release/v<version>` if present.
2. `git ls-remote` exact remote branch `refs/heads/release/v<version>`.
3. `gh` read lookup for a PR with head `release/v<version>` into `main`.

**Fresh preparation** — no corresponding local branch, remote branch, or PR:

- Require clean worktree.
- Require current `HEAD` equals current remote `main` tip.
- Shared prechecks: version/date shape, `gh` auth, signing config checks that
  can run without creating a commit.
- Then: edit files → create branch → signed commit → push → `gh pr create`.

**Resume preparation** — any of local branch, remote branch, or matching PR
exists:

- Do **not** require `HEAD ==` remote `main`.
- Allow running while checked out on the matching release branch, **or**
  inspect the branch by ref without requiring checkout.
- Require clean worktree (no unrelated dirt that would confuse validation).
- Validate any existing release commit against the invariant set below.
- Finish only the missing steps (push and/or PR). Never recreate the commit.
- Never delete or force-update branches.

Mode selection must happen before fresh-only `HEAD == main` enforcement.

### Release-commit invariants (resume identity)

Do **not** define identity as “the SHA that would result from repeating
`git commit -S`”. Commit IDs depend on parent, author/committer identities and
timestamps, message, and signature material; a rerun cannot recreate the same
SHA.

After a commit exists, its **actual SHA** is the recovery identity. Validate
that commit against this invariant set:

1. Branch name is exactly `release/v<version>`.
2. Commit has exactly one parent.
3. That parent is the preparation base: the remote `main` tip that was current
   when the release commit was created. With no extra hidden state, identify
   the base as the release commit’s sole parent once the commit passes the
   other invariants (message, signed, release-file-only diff, versions,
   changelog). If current remote `main` has advanced, resume remains allowed
   when the validated release commit’s parent is still an ancestor of current
   remote `main` **and** the release commit still satisfies all content
   invariants; refuse automatic recovery when local and remote release-branch
   tips diverge, when the parent relationship is ambiguous, or when content
   no longer matches `--version` / changelog expectations. Prefer refusing
   over guessing when remote `main` movement makes the intended base unclear.
4. Commit message is exactly `release: <version>`.
5. Commit is cryptographically signed and Git reports a valid signature under
   the project’s chosen verification rule (e.g. `git verify-commit`); CI stubs
   this path.
6. Committed `CHANGELOG.md`, `package.json`, and root `package-lock.json`
   contain the expected release state for `--version` (versions match;
   changelog section satisfies prepare-time assert against the section’s own
   date via `--release-date` only when that date is still today-or-later, or
   content checks equivalent for already-committed files — prefer invoking
   helpers without inventing a third parser). For resume of an already-cut
   changelog whose section date may be “today” relative to commit time but
   past relative to resume day, validate committed file contents against
   `--verify-release-date <section-date>` plus package/lock version equality
   rather than re-running prepare-time `--release-date`.
7. No other paths differ from the parent (release-files-only diff).
8. Where both local and remote `release/v<version>` exist, they must point to
   the same validated commit SHA.

### Resume scenarios

| Observed state | Behavior |
| --- | --- |
| Local matching validated branch, no remote branch | Push that SHA; then ensure PR. |
| Remote matching validated branch, no local branch | May fetch/create local tracking ref without force; ensure PR. Or operate on remote SHA via inspection without checkout. |
| Matching remote branch, missing PR | Create PR only. |
| Existing PR whose head SHA is the validated release commit | Report PR URL; no duplicate; success / already-complete. |
| Divergent local vs remote release branches | Hard refuse; manual investigation. |
| Branch/PR tip fails invariant validation | Hard refuse. |
| Dirty / partial file edits before any commit | Refuse while dirty; operator restores clean tree manually. No automatic reset. |
| Remote `main` advanced after release commit; commit still validates; parent still ancestor of current main; refs agree | Resume push/PR only as needed. |
| Remote `main` advanced in a way that makes base/intent ambiguous (divergent tips, invariant failure) | Hard refuse. |

`prepare --execute` success: a validated release commit exists on
`release/v<version>`, that branch is on `origin`, and a non-merging PR into
`main` exists for that head SHA (created now or already present).

### `tag`

1. Clean worktree.
2. Require `HEAD ==` current remote `main` tip (same tip safety as fresh
   prepare). Do **not** allow tagging an arbitrary ancestor merely because
   package/changelog versions still match — that can omit later fixes already
   on `main`. Tests cover remote main advancing between local checkout and
   tag (stale HEAD refused).
3. `package.json` version equals `--version`.
4. Derive changelog date; optional explicit `--release-date` must match;
   invoke `assert-changelog-release-ready.mjs --verify-release-date <D>`;
   smoke `changelog.mjs` as appropriate.
5. Exact remote tag collision via
   `git ls-remote --exit-code --tags origin refs/tags/v<version>` on dry-run
   and execute; also refuse local tag existence. No create-then-push collision
   discovery. Never force-move or delete tags; refuse recreating a colliding
   tag; require manual investigation for prior releases under that version.
6. `--execute`: `git tag -a -s "v<version>" -m "v<version>"` at `HEAD`. With
   `--push`, push only that tag ref. Signing failure leaves no lightweight tag.

### Documentation

Update `RELEASING.md` for:

- prepare → review/merge → update-to-main-tip → tag[`--push`];
- changelog-derived tag dates via `--verify-release-date`;
- fresh vs resume prepare;
- dry-run remote-read semantics.

## Acceptance Criteria

- Dry-run performs no worktree/index mutations, no local Git metadata mutations
  (including no `git fetch`), and no remote mutations; remote read-only queries
  allowed; mechanically tested.
- `prepare` uses assert `--release-date` (rejects past dates). `tag` uses
  `--verify-release-date` (accepts valid earlier-day changelog dates; rejects
  date mismatch). Delayed tagging after day-N prepare / day-N+1 merge works
  without claiming that `--release-date` alone would allow it.
- Helper tests prove: prepare-mode past date rejected; verify-mode earlier-day
  accepted; verify-mode explicit mismatch rejected.
- Fresh prepare requires clean tree and `HEAD ==` remote `main` tip; creates
  signed release commit, pushes branch, opens non-merging PR.
- Resume is selected before fresh-only checks; does not require `HEAD ==`
  remote `main`; validates existing commit invariants; resumes push and/or PR;
  never recreates/predicts commit SHAs; never deletes/force-updates branches.
- Documented resume behaviors cover local-only, remote-only, missing PR,
  matching PR, divergent branches, and remote-main advancement cases above.
- Matching validated PR is reported without duplicate creation.
- `prepare` never merges, never tags, never npm-publishes.
- `tag` requires `HEAD ==` current remote `main` tip; refuses stale ancestor
  checkouts when main has advanced; refuses exact remote tag collisions via
  `ls-remote` before local tag creation.
- Tag push only with `--push` + `--execute` on `tag`.
- Strict/duplicate flag parsing; subprocess errors include operation + stderr
  without credentials.
- `RELEASING.md` updated; remote job behavior unchanged.
- CI uses fixtures, bare remotes, stubbed `gh`/signing — no live GitHub/npm.

## Verification

Strategy only — results stay in the test suite, review, and CI:

```sh
npm run format:check
npm run lint
npm run type-check
npm run build
npm test
git diff --check
```

Focused cases must include: assert `--release-date` vs `--verify-release-date`
behavior; dry-run purity; fresh prepare; resume after commit-without-push and
push-without-PR; divergent-branch refusal; matching-PR idempotence; remote-only
tag collision; tag requiring main tip (stale ancestor refused); tag on a UTC
day later than prepare. Live signing/`gh`/push against `vipentti/planlet`
remain operator gates. No `## Verification Evidence` unless later required.

## Risks and Considerations

- Historical verify mode is load-bearing for delayed tag; using `--release-date`
  for tag would still reject past dates — the new flag exists specifically to
  avoid that contradiction without weakening prepare-time rules.
- Resume must not apply fresh `HEAD == main` checks; otherwise the normal
  post-commit state can never reach recovery.
- Commit SHA prediction is unsuitable for idempotency; invariant validation of
  the actual SHA is the recovery model.
- Tagging only the current remote `main` tip avoids releasing an outdated
  main-reachable commit when later fixes already landed.
- Prepare network mutations under `--execute` remain gated by dry-run default
  and fail-closed prechecks; no automatic branch delete/force-update.
- Signing/`gh` depend on operator setup; CI stubs those paths.
- Tag push still waits on Environment `release`; script must not claim npm
  success.
- `git ls-remote` / `gh` reads need network in dry-run; distinct from Git
  metadata or remote-write mutations.

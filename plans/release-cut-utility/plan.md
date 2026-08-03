# Release-cut maintainer utility

## Summary

Add a dependency-free maintainer script that collapses the still-manual
release-cut operator steps from `RELEASING.md` into two explicit subcommands:
`prepare` (changelog cut, version alignment, signed release commit, branch push,
and PR into `main`) and `tag` (annotated signed tag, optional push). Remote
publish stays with environment-gated `release.yml`. No auto-merge and no
auto-tag after merge.

Dry-run stays strictly non-mutating. `prepare` and `tag` each select **fresh**
vs **resume** before applying fresh-only checks. Resume validates existing
objects against invariants (never by predicting SHAs or recreating tags). The
assert helper is the sole changelog parser and exposes resolved dates through
one fixed machine-readable CLI contract. Signature checks guarantee local
cryptographic validity only, not maintainer authorization. Fresh prepare and
fresh tag **must** verify the newly created object with `git verify-commit` /
`git verify-tag` (and full invariants) **before** any push; signing prechecks
are preliminary only. Prepare release-commit content checks are always
**SHA-anchored** to one resolved candidate commit (blob extraction into a temp
dir; never the ambient worktree). `tag` requires `HEAD` equal to the current
remote `main` tip. Prepare PR lookup distinguishes open, merged,
closed-unmerged, and conflicting PR states. Remote-ref probes use exact
`git ls-remote --exit-code` status classification.

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
- Narrow extension of `scripts/assert-changelog-release-ready.mjs` with the
  exact historical / machine-readable contract defined under Approach
  (flags `--verify-release`, optional `--verify-release-date`, optional
  `--print-release-date`). Existing `--release-date` preparation mode and
  ordinary CI mode stay unchanged.
- `prepare` fresh / resume (branch + commit invariants; PR state handling;
  shared SHA-anchored candidate-commit validator via blob extraction).
- `tag` fresh / resume (local annotated signed tag invariants; optional push;
  remote tag always investigation-required).
- Signature policy: local cryptographic validity via `git verify-commit` /
  `git verify-tag` exit status only (not maintainer allowlisting). Mandatory
  **post-creation** verification of the exact new commit/tag before any push;
  early signing-configuration prechecks are preliminary diagnostics only and
  do not replace it.
- Dry-run by default; mutations require `--execute`. `--push` is valid only on
  `tag` and still requires `--execute`. Prepare has no separate `--push`.
- Remote-ref probes use the exact found / absent / failed classification under
  Approach.
- Update `RELEASING.md` for the scripted operator path and these contracts;
  leave workflow / trusted-publishing narrative authoritative for the remote
  job.
- Fixture / subprocess tests (temp repos, bare remotes, stubbed `gh` /
  signing). CI must not require live GitHub or real operator keys.

Out of scope:

- A single `npm run release` that mixes phases.
- `planlet release` or any product-CLI / skill / planlet-lifecycle change.
- Changing `.github/workflows/release.yml`, Environment `release`, tag rulesets,
  or npm trusted publishing.
- Auto-merge of the version PR; auto-reopen of closed PRs; automatic post-merge
  tag.
- Version selection / semver inference, changelog prose generation, prerelease
  channels, or direct `npm publish`.
- Force-updating, moving, or deleting tags or release branches.
- New runtime dependencies.
- Predicting/regenerating commit or tag object IDs for idempotency.
- Independent changelog regex/parsing inside `release.mjs`.
- Scraping unstructured assert stderr/stdout for dates.
- Maintainer-authorization / allowlist checks for signers (cryptographic
  validity only).
- JSON machine-readable assert output (the contract is line-oriented date
  print only).

## Approach

### Operator workflow

1. Fresh prepare on a clean checkout at the current remote `main` tip:
   `npm run release:prepare -- --version X.Y.Z` (dry-run), then `--execute`.
2. Human reviews and merges the opened PR into `main` (no auto-merge). Merge
   may land on a later UTC day than prepare.
3. After merge, on a clean checkout updated so `HEAD` equals the current remote
   `main` tip:
   `npm run release:tag -- --version X.Y.Z --execute` (local tag), then the same
   with `--push` when ready — or `… --execute --push` in one step. No
   remembered prepare-time date.

### Shared CLI rules

1. Parse subcommand first (`prepare` | `tag`). Shared flags: required
   `--version`, optional `--release-date` (prepare cut only; on `tag` maps to
   helper `--verify-release-date`), `--execute`, `--help`. Tag-only: `--push`.
   Reject unknown flags and duplicate values consistently.
2. Never run `npm publish`, merge a PR, create a release tag during `prepare`,
   or perform worktree / index / remote-write / local-ref-write mutations during
   dry-run.
3. Subprocess failures name the failed operation and include enough stderr for
   recovery without echoing credentials.
4. Assert helper is the sole changelog parser. `release.mjs` invokes it with
   the exact flags below and reads the exact machine-readable stdout contract.
   `changelog.mjs` may smoke-extract notes only; it is not the date owner.

### Mutation classes (dry-run contract)

| Class | Examples | Dry-run | `--execute` |
| --- | --- | --- | --- |
| Remote read-only | `git ls-remote`, `gh` read APIs | Allowed | Allowed |
| Local Git metadata mutation | `git fetch`, writing `FETCH_HEAD`, creating remote-tracking refs | Forbidden | Allowed when required; prefer `--no-write-fetch-head` where useful; never force-update a conflicting existing local ref |
| Worktree / index mutation | editing files, `git add` / `commit`, creating local branches/tags, checking out the release branch | Forbidden | Allowed for intended steps only; candidate validation must **not** require checking out the candidate |
| Remote mutation | `git push`, `gh pr create` | Forbidden | Allowed for intended steps |
| Process-ephemeral temp files | OS temp dir extracts of candidate blobs | Allowed (create/delete outside the repo) | Allowed; always cleaned up |

Dry-run acceptance is mechanically testable: after dry-run, worktree, index,
and local refs (including remote-tracking refs) are unchanged aside from
process-ephemeral temp files outside the repository that are removed before
exit.

### Remote-ref probes (`git ls-remote --exit-code`)

Probe exact refs only, for example:

- `git ls-remote --exit-code origin refs/heads/main`
- `git ls-remote --exit-code origin refs/heads/release/v<version>`
- `git ls-remote --exit-code --tags origin refs/tags/v<version>`

Classification (do **not** infer absence from stderr text):

| Result | Condition |
| --- | --- |
| **Found** | Exit `0`, and stdout contains exactly one logical match for the requested ref name. For tags, a single annotated tag may produce two lines (`refs/tags/vX` and `refs/tags/vX^{}`); that pair for the **exact** tag name is found, not a collision. Record the tag-object SHA from the non-peeled line. |
| **Absent** | Exit `2`, and stdout has no matching ref lines for that exact name. |
| **Failed** | Any other exit status; or exit `0` with malformed / empty / unexpected output; or exit `0` with multiple distinct non-peel ref names; or similarly prefixed but nonmatching refs only (must not count as the exact ref). |

Rules:

- Prefix matches (e.g. `v1.2` when requesting `v1.2.0`) are not accepts.
- Remote `main` **absent** is not recoverable: treat as fail-closed for prepare
  fresh and tag (classify as absent, then refuse with a clear error).
- Apply the same classifier to main, release-branch, and tag probes.

Fixture tests must assert: found ref; absent ref (exit 2); inaccessible remote;
malformed remote URL; exact annotated tag plus peeled `^{}` line; similarly
prefixed nonmatching refs do not count as found.

### Assert helper contract (exact CLI)

Extend `scripts/assert-changelog-release-ready.mjs` only. No JSON mode.

#### Flags

| Flag | Meaning |
| --- | --- |
| (none of the date modes) | Ordinary CI mode — unchanged |
| `--release-date YYYY-MM-DD` | **Preparation / strict** mode only — unchanged: not-in-the-past, dated section equals `D`, etc. |
| `--verify-release` | Historical verification mode (no not-in-the-past) |
| `--verify-release-date YYYY-MM-DD` | Optional expected date **in historical mode only**; requires `--verify-release` |
| `--print-release-date` | Machine-readable success output; **requires `--verify-release`** |

#### Mutual exclusion and combinations

- `--release-date` and `--verify-release` are mutually exclusive.
- `--verify-release-date` without `--verify-release` is a usage error.
- `--print-release-date` without `--verify-release` is a usage error.
- `--print-release-date` with `--release-date` (strict prep) is a usage error.
- Duplicate occurrences of any of these flags fail (same hardening as today’s
  duplicate `--release-date` pre-scan).
- Unknown flags fail with usage.

#### Historical mode semantics (`--verify-release`)

On success, the changelog must have:

- exactly one empty `[Unreleased]` section;
- exactly one section matching the current `package.json` version;
- that section’s date a valid `YYYY-MM-DD`;
- non-empty release notes.

If `--verify-release-date D` is supplied, the section date must equal `D`.
If `--verify-release-date` is omitted, derive the section date.

Malformed, missing, or multiple matching version sections → validation
failure.

#### Machine-readable stdout (`--verify-release --print-release-date`)

On **success**:

- stdout is exactly the resolved date digits `YYYY-MM-DD` followed by a single
  trailing newline (`\n`), and nothing else;
- diagnostics (if any) go to stderr only;
- exit status `0`.

On **validation failure** or usage error:

- stdout is empty;
- human-readable diagnostics on stderr;
- nonzero exit status (preserve the helper’s existing nonzero convention for
  assertion failures; usage errors likewise nonzero).

#### `--help`

- Prints usage including the new flags to **stdout** via the existing
  `console.log` help path (same as today’s helper).
- Exit `0`.
- Does not require changelog files to be valid.
- Validation failures and usage errors continue to use `console.error` on
  **stderr** and exit `1` (existing `fail()` convention).

#### Modes preserved

- Ordinary CI (no date-mode flags): unchanged.
- `--release-date D`: unchanged strict preparation semantics including
  not-in-the-past.

#### How `release.mjs` calls the helper

Tag (and prepare-resume content checks that need the recorded date):

```sh
node scripts/assert-changelog-release-ready.mjs --verify-release --print-release-date
```

When the operator passes `tag --release-date D`, map to:

```sh
node scripts/assert-changelog-release-ready.mjs \
  --verify-release \
  --verify-release-date D \
  --print-release-date
```

Prepare cut uses existing:

```sh
node scripts/assert-changelog-release-ready.mjs --release-date D
```

`release.mjs` reads one stdout line, trims the trailing newline, and requires
`/^\d{4}-\d{2}-\d{2}$/`. It does not parse the changelog.

Helper tests must cover: derive+print; explicit match; explicit mismatch;
malformed/duplicate sections; exact stdout bytes; `--print-release-date`
outside historical mode fails; mutual exclusion; duplicates; unchanged CI and
`--release-date` past rejection.

### Release-date resolution

- **`prepare`:** default `--release-date` to today UTC; write into changelog;
  call assert `--release-date <D>`.
- **`tag`:** call `--verify-release --print-release-date` (and
  `--verify-release-date` when the operator supplied a date). Consume printed
  date only.

### Signature verification policy (exact)

Policy goal: **signed and locally cryptographically valid**. This does **not**
prove the signer is an authorized maintainer and must not be described as
authorization.

#### Commands

- Commits: `git verify-commit <commit>` — success iff exit status `0`.
- Annotated tags: `git verify-tag <tag>` — success iff exit status `0`.

Do not scrape human-readable verify output for trust wording or identity.
Decision is exit status only (plus confirming the object is the intended
annotated tag / commit via Git plumbing as needed for other invariants).

#### GPG and SSH

- Both GPG and SSH signing are acceptable if the local Git installation can
  verify them through the commands above.
- For SSH verification, the operator’s Git must be configured such that
  `git verify-commit` / `git verify-tag` work (typically `gpg.format=ssh` and
  `gpg.ssh.allowedSignersFile` pointing at an allowed signers file that
  includes the releasing key). If verification tooling or required config is
  missing and verify exits nonzero, fail closed with an error naming the
  failed verify command and pointing at signing setup — do not skip the check.

#### Trust / identity

- Cryptographic validity alone is sufficient (`verify-*` exit `0`).
- An “unknown trust” GPG signature that still yields verify exit `0` is
  accepted.
- No allowlist; no requirement that the signer matches `user.email` /
  `user.signingkey` of the current operator.
- Resume **accepts** an object signed by a different key than the current
  operator when `verify-*` exits `0`.

#### Preliminary signing prechecks vs post-creation verification

- Non-mutating early checks (signing configured / verify tooling present) are
  **preliminary diagnostics only**. They may fail closed before edits when
  clearly broken, but they **do not** prove a future object will verify.
- Dry-run may report that signing and post-creation verification will be
  required; it must **not** claim a future object is already cryptographically
  verified.
- **Mandatory post-creation verification** of the exact new object is required
  before any push (and before `gh pr create` for prepare). This is the
  authoritative application of the policy.

#### Where applied

- Fresh prepare: after `git commit -S`, before push/PR — shared SHA-anchored
  validator including `git verify-commit <candidate-sha>`.
- Fresh tag: after `git tag -a -s`, before any tag push — full local-tag
  invariants including `git verify-tag`.
- Resume prepare: candidate SHA selection + shared SHA-anchored validator
  before any remote mutation (not the ambient worktree).
- Resume tag: same local-tag invariant + verify checks on the existing object
  before any remote mutation.

#### CI / fixtures

- Stub or fixture-control `git verify-commit` / `git verify-tag` (or use test
  repos with known keys) to cover: valid signed, invalid/tampered, unsigned /
  lightweight, verify-tooling-missing → refuse, and **post-creation verify
  failure with no push**.
- “Wrong signer” relative to an allowlist is **out of scope**; do not add
  allowlist fixtures. A second valid key still counts as valid under this
  policy.

### `prepare` mode selection (before fresh-only checks)

Discover state for `--version`:

1. Local `refs/heads/release/v<version>` if present.
2. Remote exact branch probe (found / absent / failed).
3. `gh` lookup of open, closed, and merged PRs for head `release/v<version>`.

**Fresh** — no local branch, remote branch, or relevant PR: clean worktree;
`HEAD ==` remote main tip; then the ordered fresh path below.

**Resume** — any of those exist: do not require `HEAD ==` main; resolve exactly
one **candidate commit SHA** (below); run the shared SHA-anchored validator;
finish push/PR per PR-state rules; never recreate commit; never
delete/force-update; do not check out the release branch solely to validate.

### Candidate commit selection

Before content validation, resolve exactly one candidate release commit SHA:

| Observed refs | Candidate SHA |
| --- | --- |
| Local-only `release/v<version>` | Exact local tip |
| Remote-only `release/v<version>` | Exact remote tip (after `--execute` fetch into a controlled ref; see remote-only resume) |
| Local and remote both present | Both must resolve to the **same** SHA; that SHA is the candidate |
| Matching PR present | PR head SHA must equal the validated branch candidate SHA |
| Disagreement / multiple plausible unequal SHAs | Hard-refuse |

All subsequent release-commit invariant checks are anchored to this exact SHA,
independent of the current checkout.

### Shared SHA-anchored release-commit validator

Fresh post-creation and resume **must** call the **same** function against the
exact candidate SHA. Do not maintain a worktree-based validator for fresh mode
and a different path for resume.

#### Content validation from the candidate tree (not the worktree)

Validate these paths **as stored in the candidate commit**:

```text
CHANGELOG.md
package.json
package-lock.json
```

Preferred method: extract exact blobs with `git show <candidate-sha>:<path>`
into a temporary directory under the OS temp location (outside the repository).
Avoid temporary detached worktrees unless blob extraction is insufficient;
never validate by reading the ambient checkout.

Procedure:

1. Resolve `<candidate-sha>` as above (must already be available as a local
   object; see remote-only / dry-run rules).
2. Extract the three paths into a uniquely named temp directory (safe random
   path components; do **not** use raw version text as an unchecked filesystem
   path segment).
3. Treat missing, non-blob, unreadable, or malformed expected paths as
   invariant failure.
4. Read extracted `package.json` and root `package-lock.json`; require both root
   `version` fields equal `--version`.
5. Invoke the trusted helper from the **current reviewed codebase** (never a
   script from the candidate commit), passing extracted file paths as argv
   array elements (no shell concatenation), for example:

```sh
node scripts/assert-changelog-release-ready.mjs \
  --verify-release \
  --print-release-date \
  <temp>/CHANGELOG.md \
  <temp>/package.json
```

   (Plus `--verify-release-date D` when the operator supplied an expected date
   on resume paths that need it.)
6. Never pass the current checkout’s `CHANGELOG.md` / `package.json` when
   validating a candidate release commit.
7. Remove the temporary directory in `finally`-style cleanup on both success
   and failure.
8. Candidate file contents are **data only** — do not extract or execute any
   scripts from the candidate commit.

#### Other invariants on the same SHA

Also require, using Git plumbing against `<candidate-sha>` (not the worktree):

1. Branch name context is exactly `release/v<version>` for the refs under
   inspection.
2. Exactly one parent; that parent is the preparation base once other
   invariants pass.
3. If remote main advanced: resume only when parent is still an ancestor of
   current remote main, content invariants hold, and local/remote tips agree;
   else hard-refuse.
4. Message exactly `release: <version>`.
5. `git verify-commit <candidate-sha>` exit `0`.
6. Release-files-only diff: compare **exact candidate commit** to **exact
   parent** (`git diff-tree` / equivalent). Independent of the checked-out
   branch.
7. Local and remote tips agree when both exist (already enforced by candidate
   selection).

### Remote-only resume and dry-run object availability

- Dry-run must not fetch or mutate local Git metadata.
- If the remote candidate object is **not** already available locally, dry-run
  must report that full candidate-tree validation requires `--execute` and exit
  **nonzero** — never claim success.
- Under `--execute`, fetch the exact release branch into a controlled
  temporary or remote-tracking ref **without** force-updating an existing
  conflicting local ref. Validate the fetched exact SHA with the shared
  validator **before** creating any local branch tip, pushing, or creating a
  PR. Do **not** blindly check out the remote branch.

### Fresh prepare ordering (post-creation verify before push)

```text
prechecks (incl. preliminary signing diagnostics)
→ edit release files
→ create branch release/v<version>
→ git commit -S -m "release: <version>"
→ resolve exact new commit SHA
→ shared SHA-anchored validator(candidate-sha)
   (blob extract + helper + verify-commit + diff-tree + …)
→ only then: git push -u origin release/v<version>
→ only then: gh pr create (per PR-state rules)
```

If post-creation invariant or `verify-commit` fails:

1. Refuse push and refuse PR creation.
2. Leave the local branch and commit **untouched** (no reset, rewrite, delete,
   or automatic recreate).
3. Error must state clearly that the release commit was created locally but was
   **not pushed** because post-creation verification failed.
4. The actual commit SHA remains the recovery identity; a later rerun enters
   **resume** and either validates successfully (then may push/PR) or continues
   to refuse.

### Prepare PR state handling

Lookup open, closed, and merged PRs for head `release/v<version>`:

| State | Behavior |
| --- | --- |
| Open; head SHA = validated commit; base `main` | Report URL; success; no duplicate |
| Merged; same identity | Report already merged/complete; no push/PR create; distinct success message |
| Closed unmerged; same head identity | Hard-refuse; no reopen/replacement |
| Conflicting (SHA differs, base ≠ `main`, multiple relevant PRs, etc.) | Hard-refuse |

Create PR only when full lookup finds no relevant open/closed/merged PR.

### Other prepare resume scenarios

| State | Behavior |
| --- | --- |
| Checked out on `main` (or unrelated HEAD); valid local release branch elsewhere | Resolve candidate from branch tip; SHA-anchored validate; no checkout required |
| Clean worktree files differ from candidate commit | Candidate wins; validate extracted blobs only |
| Candidate valid, current checkout invalid | Resume succeeds validation |
| Current checkout valid, candidate invalid | Hard refuse |
| Local validated, no remote | Push; then PR handling |
| Remote-only; object already local | Validate fetched/available SHA; no blind checkout |
| Remote-only; object not local (dry-run) | No fetch; report need `--execute`; exit nonzero |
| Remote-only; `--execute` | Controlled fetch; validate SHA; then PR/local-ref steps without force |
| Remote validated, no relevant PR | Create PR |
| Local commit exists after post-creation verify failure (never pushed) | Resume: shared validator; if now valid, push/PR; if still invalid, refuse and leave untouched |
| Divergent local/remote tips | Hard refuse |
| Invariant failure | Hard refuse |
| Dirty pre-commit tree (fresh only) | Refuse; manual restore |
| Main advanced; still valid; tips agree | Resume per rules |
| Ambiguous main advancement | Hard refuse |

### `tag` fresh vs resume

Shared: clean worktree; `HEAD ==` remote main tip; package version match;
helper `--verify-release --print-release-date` (+ optional
`--verify-release-date`); remote tag probe found/absent/failed.

- **Remote tag found:** hard-refuse (investigation-required). Never
  force-move/delete.
- **Remote probe failed:** fail closed.

#### Fresh tag ordering (post-creation verify before push)

Including one-step `tag --execute --push`:

```text
prechecks (incl. preliminary signing diagnostics)
→ git tag -a -s "v<version>" -m "v<version>" HEAD
→ resolve exact tag via refs/tags/v<version>
→ validate local-tag invariants (annotated; name; message; peeled target == HEAD;
   git verify-tag exits 0)
→ only then, if --push: git push origin refs/tags/v<version>
```

There is **no** path that creates a tag and pushes without verification in
between. Signing failure during create must leave no lightweight tag. If
post-creation validation or `verify-tag` fails:

1. Refuse any tag push.
2. Leave the local tag **untouched** (never recreate, move, force-update, or
   delete automatically).
3. Error must state clearly that the tag exists locally but was **not pushed**
   because post-creation verification failed.
4. A later rerun enters **local-tag resume** and either validates successfully
   or continues to refuse.

#### Resume — existing local tag, remote absent

Validate: name `v<version>`; annotated (not lightweight); `git verify-tag`
exit `0`; peeled target is exact current `HEAD`; `HEAD` still remote main tip;
message exactly `v<version>`; package + helper verify still pass. Without
`--push`: report exists, success. With `--push --execute`: push that tag only.
Never recreate/move/delete/force. **Invalid local tag:** hard-refuse.

### Documentation (`RELEASING.md`)

Document operator flow; exact assert flags (`--verify-release`,
`--verify-release-date`, `--print-release-date` vs `--release-date`); signature
policy (crypto validity only); mandatory post-creation verify before push;
SHA-anchored candidate validation (not worktree); remote-only resume /
dry-run object limits; prepare/tag fresh/resume; PR states; ls-remote exit
classification; local-tag-then-push; errors that leave unverified-but-created
local objects for investigation.

## Acceptance Criteria

- Dry-run non-mutating per mutation classes; mechanically tested.
- Assert helper sole changelog date parser; exact flags and stdout contract
  above; `release.mjs` consumes printed date only.
- Prep `--release-date` rejects past dates; historical `--verify-release`
  accepts earlier-day dates; mismatch via `--verify-release-date` rejected.
- Helper tests cover the contract rows listed under Assert helper contract.
- Signature checks use `git verify-commit` / `git verify-tag` exit `0` only;
  no allowlist; resume accepts other valid keys; missing verify config fails
  closed.
- Fresh prepare: create commit → full invariant + `verify-commit` on exact SHA
  → only then push/PR. Verify failure: no push/PR; local commit left for
  inspection; error states not-pushed-due-to-verification-failure; rerun uses
  resume.
- Fresh and resume prepare share one SHA-anchored validator: resolve one
  candidate SHA; extract `CHANGELOG.md` / `package.json` / `package-lock.json`
  blobs to a temp dir; run helper on those paths; diff-tree vs parent; never
  validate ambient worktree files as the candidate.
- Remote-only dry-run without local object: no fetch, no false success. Execute
  fetches controlled ref, validates before branch/PR mutations; no blind
  checkout.
- Fresh tag / `--execute --push`: create tag → full invariant + `verify-tag` →
  only then optional push. Same leave-local / resume behavior on failure. No
  create-then-push without verify.
- Preliminary signing prechecks do not replace post-creation verification;
  dry-run does not claim future objects are already verified.
- Fresh/resume prepare and tag behaviors, PR states, and remote-tag refusal as
  specified.
- ls-remote: exit `0` found (with peel-pair OK), exit `2` absent, else failed;
  fixture tests for found/absent/inaccessible/malformed URL/peel pair/prefix
  nonmatch; remote main absent fail-closed.
- `tag` requires `HEAD ==` remote main tip.
- Strict/duplicate flags; subprocess errors with operation + stderr, no
  credentials.
- `RELEASING.md` documents these contracts; remote job unchanged; CI fixtures
  only.

## Verification

Strategy only:

```sh
npm run format:check
npm run lint
npm run type-check
npm run build
npm test
git diff --check
```

Focused cases: helper flag matrix and exact stdout; dry-run purity; fresh
prepare; resume push/PR; PR open/merged/closed/conflict stubs; tag local resume
and push-fail retry; invalid local tag; remote tag refuse; ls-remote status
matrix; verify-commit/tag valid/invalid/unsigned/missing-tooling; stale main
tip; later-UTC-day tag; post-creation verify success then push; post-creation
verify failure with no push/PR and local object retained; later rerun resume
after failed post-creation verify; `--execute --push` create → verify → push
ordering; no cleanup/force after verify failure; **resume while on `main` with
release branch elsewhere**; **worktree data differs from candidate**;
**candidate valid / checkout invalid succeeds**; **checkout valid / candidate
invalid refuses**; **remote-only fetch+validate without checkout**; **dry-run
remote-only unavailable locally**; missing/malformed candidate paths refuse;
shared validator for fresh+resume; helper receives extracted paths; temp
cleanup on success/failure; no candidate-controlled script execution. Live
signing/`gh`/push remain operator gates.

## Risks and Considerations

- Fixed `--print-release-date` line contract avoids JSON-vs-text ambiguity for
  implementers.
- Separate `--verify-release-date` avoids overloading prep `--release-date`.
- Crypto-validity-only signing is weaker than maintainer authorization; stated
  explicitly so operators are not misled. Environment `release` reviewers remain
  the publish gate.
- Signing prechecks cannot prove the created object verifies (e.g. SSH sign vs
  `allowedSignersFile` mismatch); post-creation `verify-*` before push is
  load-bearing. Leaving the local object on failure is intentional for
  investigation and resume — never auto-cleanup.
- Validating ambient worktree files during resume would approve the wrong tree
  when HEAD ≠ candidate; SHA-anchored blob extraction is load-bearing.
- SSH verify depends on local `allowedSignersFile`; missing config fails closed
  rather than skipping.
- ls-remote exit `2` is the only “absent” signal; treating other nonzeros as
  absent would proceed under outages.
- Remote tag presence stays non-resumable automatically.
- PR lookup must include closed/merged to avoid duplicate replacements.

# Release-cut maintainer utility

## Summary

Add a dependency-free maintainer script that collapses the still-manual
release-cut operator steps from `RELEASING.md` into two explicit subcommands:
`prepare` (changelog cut, version alignment, signed release commit, branch push,
and PR into `main`) and `tag` (annotated signed tag, optional push). Remote
publish stays with environment-gated `release.yml`. No auto-merge and no
auto-tag after merge.

Dry-run stays strictly non-mutating. Both subcommands select their mode before
applying fresh-only checks: `tag` chooses **fresh** vs **resume**, and
`prepare` chooses **fresh**, **branch-backed resume**, or **PR-only history**.
Resume validates existing
objects against invariants (never by predicting SHAs or recreating tags). The
assert helper is the sole changelog parser and exposes resolved dates through
one fixed machine-readable CLI contract. Signature checks guarantee local
cryptographic validity only, not maintainer authorization. Fresh prepare and
fresh tag **must** verify the newly created object with `git verify-commit` /
`git verify-tag` (and full invariants) **before** any push; signing prechecks
are preliminary only. Prepare release-commit content checks are always
**SHA-anchored** to one resolved candidate commit (blob extraction into a temp
dir; never the ambient worktree), including all canonical root package/lockfile
version fields. Remote-only resume pins `observedRemoteReleaseSha` through
fetch and re-probes before PR. Every remote ref this utility creates — release
branch or tag — is created through an **atomic expected-absence lease**
(`--force-with-lease=<ref>:` plus a `--porcelain` new-ref status assertion),
never an ordinary push, so a concurrently created ref is always a lost race
rather than a silent accept or fast-forward. `tag` requires `HEAD` equal to the current
remote `main` tip. Mode selection classifies PR history **before** requiring a
branch-backed candidate, so a release whose head branch was deleted after merge
resolves as already-complete rather than falling back to fresh preparation.
Prepare PR lookup distinguishes open, merged,
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
- PR-only release-history classification for a deleted head branch (merged =
  already complete; closed-unmerged, open, and conflicting = hard-refuse), with
  fresh mode requiring the absence of every branch **and** every relevant PR.
- `prepare` fresh / resume (branch + commit invariants; PR state handling;
  shared SHA-anchored candidate-commit validator via blob extraction; full
  package/lockfile root version contract including `packages[""].version`;
  pinned remote probe/fetch/re-probe with temporary fetch-ref cleanup).
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
- Atomic expected-absence remote-ref creation for both `refs/heads/release/v<version>`
  and `refs/tags/v<version>`, with fail-closed behavior when the required
  compare-and-swap semantics are unavailable.
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
  tag; recreating a deleted release branch from PR metadata.
- Version selection / semver inference, changelog prose generation, prerelease
  channels, or direct `npm publish`.
- Plain `--force` pushes; force-updating, moving, or deleting tags or release
  branches. (An exact expected-absence lease is a create-if-absent operation
  only and is not an exception to this; see Remote-ref race model.)
- GitHub-specific REST ref-creation, or any new dependency, as the atomicity
  mechanism unless the standard Git mechanism provably cannot satisfy the
  contract.
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
| Local Git metadata mutation | `git fetch`, writing `FETCH_HEAD`, creating remote-tracking or temporary refs under an implementation-owned namespace | Forbidden | Allowed when required; prefer `--no-write-fetch-head` where useful; never force-update a conflicting existing local/user ref; temporary fetch refs are created only under `--execute` and cleaned up |
| Worktree / index mutation | editing files, `git add` / `commit`, creating local branches/tags, checking out the release branch | Forbidden | Allowed for intended steps only; candidate validation must **not** require checking out the candidate |
| Remote mutation | `git push`, `gh pr create` | Forbidden | Allowed for intended steps only. Every ref-creating push (release branch, tag) must use the atomic expected-absence lease form below; ordinary non-lease pushes and plain `--force` are never issued |
| Process-ephemeral temp files | OS temp dir extracts of candidate blobs | Allowed (create/delete outside the repo) | Allowed; always cleaned up |

Dry-run acceptance is mechanically testable: after dry-run, worktree, index,
and local refs (including remote-tracking refs) are unchanged aside from
process-ephemeral temp files outside the repository that are removed before
exit. Dry-run creates **no** temporary Git refs. Execute-time fetched objects
may remain in the object database (acknowledged local metadata mutation); only
implementation-owned temporary refs are deleted.

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

### Remote-ref race model (atomic expected-absence creation)

A probe is a point-in-time read. Between the probe that classified a ref as
**absent** and the push that creates it, another actor may create that ref. An
ordinary push does not fail closed in that window: if the concurrently created
ref is an ancestor of the candidate, the push fast-forwards it; if it already
points at the same object, the push reports `Everything up-to-date` and exits
`0`. Both outcomes silently accept or mutate remote state this invocation never
classified. Shrinking the window with a final re-probe does not close it.

Therefore every remote ref this utility **creates** is created with a
server-side compare-and-swap whose expected value is *ref does not exist*.

#### Mechanism and the same-SHA gap

The Git mechanism is the empty-expect lease, `--force-with-lease=<ref>:`.

Verified behavior on Git 2.54 against a bare local remote:

| Situation | `--force-with-lease=<ref>:` alone | Sufficient? |
| --- | --- | --- |
| Ref still absent | Creates ref, porcelain status `*` | Yes |
| Ref appeared at a different, non-ancestor SHA | Rejected, `stale info` | Yes |
| Ref appeared at an ancestor of the candidate | Rejected, `stale info` (no fast-forward) | Yes |
| Ref appeared at the **same** object | `Everything up-to-date`, **exit 0** | **No** |

The last row is load-bearing: Git evaluates no lease when there is no update to
apply, so the lease alone cannot distinguish "we created this ref" from
"someone else created it at the same object first". The contract therefore
requires **both** conditions:

1. the expected-absence lease, and
2. a `--porcelain` per-ref status assertion that the ref status flag is
   exactly `*` (new ref).

Any other porcelain status — notably `=` (up to date) — is a **lost creation
race**, not a success, even on exit `0`.

#### Required creation form

```sh
git push --porcelain \
  --force-with-lease=<exact-ref>: \
  origin \
  <exact-source>:<exact-ref>
```

Rules, applying identically to branches and tags:

- The expected value is explicitly "ref does not exist". Creation must fail if
  the ref exists at **any** SHA, including the validated candidate SHA itself.
- Success requires exit `0` **and** porcelain status `*` for that exact ref.
- Never retry with a broader lease, a relaxed lease, or plain `--force`.
- Never derive a lease from a possibly stale remote-tracking ref; always state
  the expected value explicitly in the flag.
- On lease failure or a non-`*` status, restart read-only discovery and
  reclassify the now-existing ref (and, for branches, the PR state), or fail
  closed. Never report the original invocation as having created the ref.
- This is a create-if-absent primitive only. It never authorizes changing,
  moving, replacing, or deleting an existing ref.

Ordering is fixed, and the final re-probe is diagnostic only:

```text
probe absent → local validation → atomic expected-absence push → post-result classification
```

#### Capability failure

- The utility must confirm the chosen invocation actually provides
  expected-absence semantics on the project's supported Git versions.
- If the lease capability is unsupported, rejected, or the porcelain status
  cannot be parsed, **fail closed**.
- Never fall back to an ordinary push.
- Diagnostics must say specifically that atomic remote-ref creation could not
  be guaranteed, rather than reporting a generic push failure.
- Tests prove the semantics against a bare local remote; no live GitHub.

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

Classify **PR history before** requiring a branch-backed candidate. A release
branch is routinely deleted after its PR merges, so branch absence alone never
implies the release was never prepared.

Mode selection is therefore three-way:

**Fresh** — requires **all** of the following to be absent:

1. local `refs/heads/release/v<version>`;
2. remote `refs/heads/release/v<version>`;
3. any relevant **open** PR;
4. any relevant **closed-unmerged** PR;
5. any relevant **merged** PR.

Then: clean worktree; `HEAD ==` remote main tip; then the ordered fresh path
below. A deleted branch does **not** make a previously merged or closed release
fresh again.

**Branch-backed resume** — a local or remote release branch exists: do not
require `HEAD ==` main; resolve exactly one **candidate commit SHA** (below);
require any relevant PR head SHA to equal that candidate; run the shared
SHA-anchored validator; finish push/PR per PR-state rules; apply pinned remote
fetch, re-probes, and atomic expected-absence creation as already specified;
never recreate commit; never delete/force-update; do not check out the release
branch solely to validate. Unchanged by this section.

**PR-only history** — no local **and** no remote release branch, but at least
one relevant PR exists. See below. These states must never fall through to
fresh preparation, and must never produce an undefined “no candidate SHA” path.

### PR-only release history (branch deleted)

Applies only when neither a local nor a remote `release/v<version>` branch
exists. Use the complete `gh` lookup for exact head branch
`release/v<version>` and base exactly `main`, across open, closed, and merged
PRs. Never pick the newest PR heuristically.

#### Merged matching PR, branch absent

An already-complete preparation state — not fresh, and not a recoverable branch
state.

Require:

- exactly one relevant merged PR;
- base exactly `main`;
- recorded head branch exactly `release/v<version>`;
- PR metadata exposes a concrete head SHA;
- no conflicting open or closed-unmerged PR for the same release head/version.

Behavior:

- report preparation already merged and complete, with the merged PR URL and
  recorded head SHA;
- do **not** recreate the release branch, push, or create another PR;
- do **not** require the historical head commit to be locally available merely
  to report the already-complete state;
- do **not** claim the historical commit was freshly revalidated when its
  object is unavailable — say what was and was not checked.

If the head object *is* already available locally, optional consistency
validation may run. Failure to fetch or retain a deleted historical branch must
never downgrade a clearly merged PR into fresh preparation.

#### Closed-unmerged matching PR, branch absent

Hard-refuse. Report that the previous release PR was closed without merge, that
its head branch is absent, that automatic reopening / branch recreation /
replacement-PR creation are out of scope, and that deliberate operator
investigation is required. Do **not** enter fresh mode despite the missing
branch.

#### Open matching PR, branch absent

Hard-refuse as inconsistent remote state. An open PR is expected to have a live
head ref. Do **not** recreate the branch from the PR's recorded head SHA.
Report that the PR remains open, its head branch cannot be found, no push or
duplicate PR creation was attempted, and manual investigation is required.

#### Conflicting or multiple PR-only history

Hard-refuse when:

- more than one relevant PR makes intent ambiguous;
- merged and closed-unmerged records conflict;
- head / base / version identity does not match exactly;
- PR metadata lacks a usable state or head identity;
- a different PR state appears during re-query.

#### Re-query and race handling

Before returning a PR-only result, re-query the relevant PR state if the
lookup may be stale. If state changes during classification, restart discovery
once or fail closed. Never transition from PR-only history into branch creation
within the same stale pass.

No remote mutation is required for any merged or closed-unmerged PR-only
outcome; these paths issue no `git push`, no atomic lease push, and no
`gh pr create`.

### Candidate commit selection

Applies to **branch-backed resume** and to fresh post-creation validation. In
PR-only history no branch-backed candidate exists; those states resolve through
the PR-only rules above and never reach this table.

Before content validation, resolve exactly one candidate release commit SHA.
For a remote release branch, record the exact SHA from the initial exact-ref
probe as `observedRemoteReleaseSha` and use that value for candidate
selection, PR-state classification relative to the branch, and the pinned
fetch below.

| Observed refs | Candidate SHA |
| --- | --- |
| Local-only `release/v<version>` | Exact local tip |
| Remote-only `release/v<version>` | `observedRemoteReleaseSha` (must be fetched and confirmed identical under `--execute`; see pinned remote-only resume) |
| Local and remote both present | Both must resolve to the **same** SHA; that SHA is the candidate |
| Matching PR present | PR head SHA must equal the validated branch candidate SHA |
| Disagreement / multiple plausible unequal SHAs | Hard-refuse |
| Neither local nor remote branch, but a relevant PR exists | No branch-backed candidate; classify under PR-only release history |

All subsequent release-commit invariant checks are anchored to this exact SHA,
independent of the current checkout.

### Package and lockfile version contract

This repository’s lockfile format (npm lockfile v2/v3 style) stores the root
project version in **three** places that must stay aligned. For both fresh
preparation edits and SHA-anchored resume/post-creation validation, require:

1. `package.json.version === requestedVersion`
2. `package-lock.json.version === requestedVersion`
3. `package-lock.json.packages[""].version === requestedVersion`
4. `package-lock.json.packages[""]` exists and is an object
5. No silent acceptance of a missing or mismatching root package version

Fresh preparation must update **all three** values through a deterministic
mechanism. Prefer existing npm-supported version update behavior if it changes
only the intended package/lockfile root fields; otherwise perform the minimum
direct JSON edits matching the repository’s formatting conventions. Do **not**
recursively rewrite dependency versions or modify unrelated lockfile entries.

The candidate validator reads these values from blobs extracted from the exact
candidate commit, never from the ambient checkout.

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
4. Parse extracted `package.json` and `package-lock.json`; enforce the full
   package/lockfile version contract above (all three root version fields +
   `packages[""]` object presence).
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

### Pinned remote-only resume (probe → fetch → re-probe)

#### Initial observation

On remote-branch **found**, record:

```text
observedRemoteReleaseSha
```

as the exact SHA from the exact-ref `ls-remote` probe. PR lookup / state
classification for that branch must be relative to this SHA (PR head must match
it for “matching” states).

#### Dry-run object availability

- Dry-run must not fetch or mutate local Git metadata / refs.
- If `observedRemoteReleaseSha` is **not** already available locally, dry-run
  must report that full candidate-tree validation requires `--execute` and exit
  **nonzero** — never claim success.
- If the object **is** already local, dry-run may run the shared validator on
  that exact SHA without fetching.

#### Controlled fetch under `--execute`

1. Create a **temporary** local ref under a dedicated implementation-owned
   namespace (collision-resistant name; never overwrite a pre-existing ref).
   Prefer this over leaving a durable remote-tracking ref.
2. Fetch the exact branch into that temp ref **without** checkout and **without**
   force-updating any application/user ref. Fetching by object ID is acceptable
   where reliable, but the result must still be tied to
   `observedRemoteReleaseSha`.
3. Resolve the fetched object SHA and **require** it equals
   `observedRemoteReleaseSha`. If it differs, report that the remote release
   branch moved during validation and either restart from a fresh read-only
   discovery pass or fail closed — do **not** continue with whichever SHA
   arrived.
4. Run the shared SHA-anchored validator on that pinned SHA **before** creating
   any local branch tip, pushing, or creating a PR. Do **not** blindly check
   out the remote branch.
5. In `finally`-style cleanup: delete **only** temporary refs created by this
   invocation. Cleanup on success and failure. Cleanup failure is reported but
   must **not** trigger remote mutation. Dry-run creates no refs. Fetched
   objects may remain in the object database (execute-time metadata mutation).

#### Before remote mutation (PR create / rely on remote branch)

Immediately before creating a PR or otherwise relying on the remote release
branch:

1. Re-probe the exact remote branch ref.
2. Require it still equals the validated candidate SHA
   (`observedRemoteReleaseSha` / validated SHA).
3. Re-check that the selected PR state still corresponds to that SHA where
   relevant.
4. Refuse if the branch disappeared or moved.

#### Local-only branch push

- Push the **exact validated candidate SHA** to the **exact** destination ref
  `refs/heads/release/v<version>` (SHA-to-ref form), not an ambiguous
  current-branch push.
- The push must use the atomic expected-absence lease per Remote-ref race
  model:

```sh
git push --porcelain \
  --force-with-lease=refs/heads/release/v<version>: \
  origin \
  <validated-candidate-sha>:refs/heads/release/v<version>
```

- Success requires exit `0` **and** porcelain status `*` for
  `refs/heads/release/v<version>`.
- If the remote branch appeared after the earlier absence check, creation fails
  closed for every variant: different SHA, ancestor SHA (no fast-forward), and
  the identical candidate SHA (porcelain `=` is a lost race, not a success).
- On failure, restart read-only discovery and reclassify the branch and PR
  state, or fail closed. Do not report the branch as created by this
  invocation, and do not proceed to PR creation on the assumption it was.
- Never plain `--force`; never retry with a relaxed lease.
- For an **existing** remote branch, the utility must **not** push merely to
  “synchronize” after validation — and must not push at all; once the exact
  remote ref is confirmed unchanged, only create or report the PR.

### Fresh prepare ordering (post-creation verify before push)

```text
prechecks (incl. preliminary signing diagnostics)
→ edit release files (changelog cut + all three package/lock root versions)
→ create branch release/v<version>
→ git commit -S -m "release: <version>"
→ resolve exact new commit SHA
→ shared SHA-anchored validator(candidate-sha)
   (blob extract + full lockfile contract + helper + verify-commit + diff-tree)
→ only then: atomic expected-absence push of exact SHA to
   refs/heads/release/v<version> (--force-with-lease=<ref>: + porcelain `*`)
→ classify push result; lease failure or non-`*` status → reclassify or fail closed
→ re-probe remote as needed; only then: gh pr create (per PR-state rules)
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

Lookup open, closed, and merged PRs for head `release/v<version>`, classified
relative to `observedRemoteReleaseSha` / the validated candidate SHA when a
remote branch is involved:

| State | Behavior |
| --- | --- |
| Open; head SHA = validated commit; base `main` | Report URL; success; no duplicate |
| Merged; same identity | Report already merged/complete; no push/PR create; distinct success message |
| Closed unmerged; same head identity | Hard-refuse; no reopen/replacement |
| Conflicting (SHA differs, base ≠ `main`, multiple relevant PRs, etc.) | Hard-refuse |

When no release branch exists at all, the same lookup is classified under
PR-only release history instead of against a candidate SHA:

| State (no local or remote branch) | Behavior |
| --- | --- |
| Exactly one merged PR; base `main`; head `release/v<version>`; concrete head SHA; no conflicting records | Report already merged/complete with URL + recorded head SHA; no branch recreation, push, or PR create; local availability of the head object not required; do not claim revalidation that did not happen |
| Closed unmerged | Hard-refuse; no reopen, branch recreation, or replacement PR; investigation required |
| Open | Hard-refuse as inconsistent remote state; never recreate the branch from the recorded head SHA |
| Multiple relevant PRs, conflicting merged/closed records, identity mismatch, unusable metadata, or state changed during re-query | Hard-refuse; never pick the newest PR heuristically |

Create PR only when full lookup finds no relevant open/closed/merged PR, and
only after the pre-mutation re-probe confirms the remote branch (if any) still
equals the validated SHA.

### Other prepare resume scenarios

| State | Behavior |
| --- | --- |
| Checked out on `main` (or unrelated HEAD); valid local release branch elsewhere | Resolve candidate from branch tip; SHA-anchored validate; no checkout required |
| Clean worktree files differ from candidate commit | Candidate wins; validate extracted blobs only |
| Candidate valid, current checkout invalid | Resume succeeds validation |
| Current checkout valid, candidate invalid | Hard refuse |
| Local validated, no remote | Atomic expected-absence push of exact SHA → exact destination ref; then PR handling |
| Remote-only; object already local at `observedRemoteReleaseSha` | Validate that SHA; no blind checkout |
| Remote-only; object not local (dry-run) | No fetch; report need `--execute`; exit nonzero |
| Remote-only; `--execute` | Temp-ref fetch pinned to `observedRemoteReleaseSha`; mismatch → refuse/restart; validate; re-probe before PR; cleanup temp ref |
| Remote moved between ls-remote and fetch | Refuse or restart discovery; do not validate the unexpected SHA |
| Remote moved/disappeared after validation before PR | Refuse |
| Concurrent remote branch appears during local-only push, at a different SHA | Lease rejects; fail closed; never force-overwrite |
| Concurrent remote branch appears at an ancestor of the candidate | Lease rejects; never fast-forwarded |
| Concurrent remote branch appears at the identical candidate SHA | Porcelain status `=`, not `*` → lost creation race; fail closed; not reported as created here |
| Lease capability unsupported or porcelain status unparseable | Fail closed naming unguaranteed atomic creation; never fall back to ordinary push |
| Remote validated, no relevant PR | Create PR only after re-probe confirms SHA |
| Merged PR, head branch auto-deleted by GitHub, no local branch | PR-only: report already complete; no branch recreation, push, or PR create |
| Merged PR, branch absent, historical head commit not available locally | PR-only success; report without claiming revalidation; never downgrade to fresh |
| Closed-unmerged PR, branch deleted | Hard refuse; never fresh; never replacement PR |
| Open PR, remote head branch disappeared | Hard refuse as inconsistent remote state |
| PR-only history with multiple or conflicting relevant PRs | Hard refuse |
| PR state changes during PR-only classification | Restart discovery once or fail closed; never create a branch in the stale pass |
| Local commit exists after post-creation verify failure (never pushed) | Resume: shared validator; if now valid, push/PR; if still invalid, refuse and leave untouched |
| Signed commit with inconsistent lockfile root versions | Hard refuse |
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
→ only then, if --push: atomic expected-absence tag push
```

The tag push, fresh or resumed, is always:

```sh
git push --porcelain \
  --force-with-lease=refs/tags/v<version>: \
  origin \
  refs/tags/v<version>:refs/tags/v<version>
```

Requirements:

- The exact local tag must already have passed all tag invariants and
  `git verify-tag` before this runs.
- Creation succeeds only if the remote tag ref is still absent: exit `0` **and**
  porcelain status `*` for `refs/tags/v<version>`.
- A remote tag existing at a **different** object fails the lease. A remote tag
  existing at the **same** tag object yields porcelain `=` and is likewise a
  failure — a pre-existing remote tag, reported as investigation-required, never
  as this invocation's successful push.
- No retry with `--force` or a relaxed lease. On failure, re-probe and report
  remote-tag presence as investigation-required.
- Expected-absence leasing never permits moving, replacing, or deleting an
  existing tag.
- Unsupported lease capability fails closed; no ordinary-push fallback.

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
`--push`: report exists, success. With `--push --execute`: push that tag only,
through the same atomic expected-absence form above.
Never recreate/move/delete/force. **Invalid local tag:** hard-refuse.

### Documentation (`RELEASING.md`)

Document operator flow; exact assert flags (`--verify-release`,
`--verify-release-date`, `--print-release-date` vs `--release-date`); signature
policy (crypto validity only); mandatory post-creation verify before push;
SHA-anchored candidate validation (not worktree); full package/lockfile root
version contract; pinned remote-only probe/fetch/re-probe; temporary fetch-ref
cleanup; prepare/tag fresh/resume; PR states; ls-remote exit classification;
local-tag-then-push; atomic expected-absence creation of the release branch and
tag, including the same-SHA lost-race case and the fail-closed capability rule;
errors that leave unverified-but-created local objects for investigation.

Document PR-only release history: that a merged release PR whose head branch
GitHub auto-deleted reports as already complete rather than re-preparing; that
a deleted branch never makes a merged or closed release fresh again; that
closed-unmerged, open-without-branch, and conflicting PR-only states
hard-refuse and require operator investigation; and that none of these paths
push, recreate a branch, or open a replacement PR.

Add recovery and collision notes covering: what a lost creation race looks like
to the operator, that the utility deliberately does not adopt a ref another
actor created, how to reclassify by rerunning discovery, and that
`--force-with-lease=<ref>:` here means create-if-absent and is never permission
to overwrite an existing branch or tag.

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
  blobs to a temp dir; enforce `package.json.version`,
  `package-lock.json.version`, and `packages[""].version` all equal
  `--version` with `packages[""]` present as an object; run helper on those
  paths; diff-tree vs parent; never validate ambient worktree files as the
  candidate.
- Fresh preparation updates all three canonical root version fields without
  rewriting unrelated lockfile entries.
- Remote-only: record `observedRemoteReleaseSha`; dry-run no fetch / no false
  success; execute temp-ref fetch must equal observed SHA; re-probe before PR;
  local-only push is SHA→exact-ref, fail closed on concurrent appearance; no
  force; no synchronize-push of an already-validated remote branch; temp refs
  cleaned up (only refs created by this invocation).
- Release-branch and tag creation both use the atomic expected-absence lease
  (`--force-with-lease=<ref>:`) and require exit `0` **plus** porcelain status
  `*`. Concurrent creation at a different SHA, at an ancestor SHA, or at the
  identical SHA all fail closed as lost creation races; no fast-forward, no
  plain `--force`, no relaxed-lease retry, and no claim that this invocation
  created the ref. Lease failure triggers rediscovery/reclassification or a
  clear fail-closed result. Ordering is probe absent → local validation →
  atomic push → post-result classification; a final re-probe is diagnostic only
  and never substitutes for the lease.
- Unsupported or unverifiable lease semantics fail closed with diagnostics
  naming unguaranteed atomic creation; never an ordinary-push fallback.
- Expected-absence leasing never moves, replaces, or deletes an existing ref.
- Fresh tag / `--execute --push`: create tag → full invariant + `verify-tag` →
  only then optional push. Same leave-local / resume behavior on failure. No
  create-then-push without verify.
- Preliminary signing prechecks do not replace post-creation verification;
  dry-run does not claim future objects are already verified.
- Fresh/resume prepare and tag behaviors, PR states, and remote-tag refusal as
  specified.
- Fresh mode requires local branch, remote branch, and every relevant open,
  closed-unmerged, and merged PR to be absent. A deleted branch never makes a
  merged or closed release fresh again.
- PR history is classified before a branch-backed candidate is required. With
  no branch present: exactly one matching merged PR (base `main`, head
  `release/v<version>`, concrete head SHA, no conflicting records) reports
  already-complete with URL and head SHA, without requiring the historical
  object locally and without claiming revalidation that did not run;
  closed-unmerged, open-without-branch, and conflicting/multiple/unusable-
  metadata states hard-refuse; newest-PR heuristics are never used.
- PR-only completed and refusal states perform no `git push`, no atomic lease
  push, and no `gh pr create`. Stale state detected during classification
  restarts discovery once or fails closed, never creating a branch in the stale
  pass.
- Branch-backed resume is unchanged: candidate SHA resolution, PR head SHA
  equality, shared validator, pinned fetch/re-probe, and atomic creation all
  still apply.
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
ordering; no cleanup/force after verify failure; resume while on `main` with
release branch elsewhere; worktree data differs from candidate; candidate valid
/ checkout invalid succeeds; checkout valid / candidate invalid refuses;
remote-only fetch+validate without checkout; dry-run remote-only unavailable
locally; missing/malformed candidate paths refuse; shared validator for
fresh+resume; helper receives extracted paths; temp cleanup on success/failure;
no candidate-controlled script execution; **all three package/lock root
versions aligned**; **stale `packages[""].version` refused**; **stale top-level
lock version refused**; **missing/malformed `packages[""]` refused**; **fresh
prep updates all three**; **resume refuses inconsistent lockfile commit**;
**stable remote SHA across probe/fetch/validate/PR**; **remote moves between
ls-remote and fetch**; **fetched SHA ≠ observed**; **remote moves/disappears
after validation before PR**; **local-only exact SHA→ref push**; **concurrent
branch appearance refuses overwrite**; **temp fetch-ref cleanup including
pre-existing same-name collision and failure-path cleanup**; **branch created
when remote stays absent**; **concurrent branch at a different SHA rejected**;
**concurrent branch at the identical SHA rejected as a lost creation race**;
**concurrently created ancestor branch not fast-forwarded**; **no plain force
push ever issued**; **lease failure reclassifies or fails closed**; **tag
created when remote tag stays absent**; **concurrent tag at a different object
rejected**; **concurrent tag at the same object rejected and reported as
pre-existing remote state**; **no tag moved, replaced, or force-updated**;
**unsupported lease semantics do not fall back to ordinary push**; **command
ordering probe absent → local validation → atomic push → classification**;
**merged PR with deleted remote branch and no local branch reports already
complete**; **merged PR-only state recreates and pushes nothing**; **merged
PR-only state works when the historical head commit is not available locally**;
**closed-unmerged PR with deleted branch hard-refuses**; **open PR with missing
branch hard-refuses**; **no branch + merged PR never enters fresh
preparation**; **no branch + closed PR never creates a replacement PR**;
**multiple relevant PR-only records hard-refuse**; **PR head/base/version
mismatch hard-refuses**; **branch-backed resume still requires PR head SHA
equality and candidate validation**; **stale PR lookup changing during
classification restarts or fails closed**; **no `git push`, lease push, or
`gh pr create` in PR-only completed or refusal states**. Live
signing/`gh`/push remain operator gates. Concurrency tests use bare local
remotes mutated between probe and push; no live GitHub.

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
- Checking only `package-lock.json.version` would miss a stale
  `packages[""].version`; both root fields are required.
- Remote branch can move between probe and fetch; pinning to
  `observedRemoteReleaseSha` and re-probing before PR prevents validating or
  acting on a different commit.
- SSH verify depends on local `allowedSignersFile`; missing config fails closed
  rather than skipping.
- ls-remote exit `2` is the only “absent” signal; treating other nonzeros as
  absent would proceed under outages.
- An ordinary push is not a safe create: it fast-forwards a concurrently
  created ancestor branch and reports exit `0` / `Everything up-to-date` when
  the ref already points at the same object. The expected-absence lease closes
  the first case; only the porcelain `*` status check closes the second, which
  is why both conditions are required rather than the lease alone.
- `--force-with-lease` is named for overwriting, and readers may take its
  presence as license to relax it into a force push. The empty-expect form is a
  distinct primitive — create-if-absent — and the plan prohibits every broader
  variant.
- Lease support can vary across Git versions and server implementations;
  failing closed rather than degrading to an ordinary push keeps the race
  guarantee honest, at the cost of refusing to operate on unsupported setups.
- Remote tag presence stays non-resumable automatically.
- PR lookup must include closed/merged to avoid duplicate replacements.
- Auto-deleting the head branch on merge is a common default, so
  merged-PR-with-no-branch is the *normal* post-release state, not an edge
  case. Treating branch absence as the fresh signal would re-prepare an
  already-released version; classifying PR history first is load-bearing.
- Deleted branches also mean the historical head commit may be unreachable
  locally. Requiring a fetchable object before reporting an already-merged
  release would convert a clean completed state into a failure or a false
  fresh, so reporting is allowed without revalidation — stated explicitly so
  operators are not misled about what was verified.
- Recreating a branch from PR-recorded head metadata would reintroduce refs the
  maintainers deliberately deleted, and for an open PR would mask a real remote
  inconsistency; both stay refuse-only.

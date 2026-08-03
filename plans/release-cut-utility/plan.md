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
cryptographic validity only, not maintainer authorization. `tag` requires
`HEAD` equal to the current remote `main` tip. Prepare PR lookup distinguishes
open, merged, closed-unmerged, and conflicting PR states. Remote-ref probes use
exact `git ls-remote --exit-code` status classification.

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
- `prepare` fresh / resume (branch + commit invariants; PR state handling).
- `tag` fresh / resume (local annotated signed tag invariants; optional push;
  remote tag always investigation-required).
- Signature policy: local cryptographic validity via `git verify-commit` /
  `git verify-tag` exit status only (not maintainer allowlisting).
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
| Local Git metadata mutation | `git fetch`, writing `FETCH_HEAD` | Forbidden | Allowed when required; prefer `--no-write-fetch-head` where useful |
| Worktree / index mutation | editing files, `git add` / `commit`, creating local branches/tags | Forbidden | Allowed for intended steps |
| Remote mutation | `git push`, `gh pr create` | Forbidden | Allowed for intended steps |

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

#### Where applied

Same policy for: fresh release-commit creation prechecks (signing usable),
resumed release-commit validation, fresh tag creation, resumed local-tag
validation.

#### CI / fixtures

- Stub or fixture-control `git verify-commit` / `git verify-tag` (or use test
  repos with known keys) to cover: valid signed, invalid/tampered, unsigned /
  lightweight, and verify-tooling-missing → refuse.
- “Wrong signer” relative to an allowlist is **out of scope**; do not add
  allowlist fixtures. A second valid key still counts as valid under this
  policy.

### `prepare` mode selection (before fresh-only checks)

Discover state for `--version`:

1. Local `refs/heads/release/v<version>` if present.
2. Remote exact branch probe (found / absent / failed).
3. `gh` lookup of open, closed, and merged PRs for head `release/v<version>`.

**Fresh** — no local branch, remote branch, or relevant PR: clean worktree;
`HEAD ==` remote main tip; then edit → branch → signed commit → push →
`gh pr create`.

**Resume** — any of those exist: do not require `HEAD ==` main; validate
commit invariants; finish push/PR per PR-state rules; never recreate commit;
never delete/force-update.

### Release-commit invariants

Actual SHA is recovery identity. Validate:

1. Branch name exactly `release/v<version>`.
2. Exactly one parent (base = that parent once other invariants pass).
3. If remote main advanced: resume only when parent is still an ancestor of
   current remote main, content invariants hold, and local/remote tips agree;
   else hard-refuse.
4. Message exactly `release: <version>`.
5. `git verify-commit` exit `0` (policy above).
6. Release file contents match `--version`; changelog via
   `--verify-release --print-release-date` (and optional
   `--verify-release-date`) on those committed files / worktree as
   implemented for resume — helper only, no third parser.
7. Release-files-only diff vs parent.
8. Local and remote tips agree when both exist.

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
| Local validated, no remote | Push; then PR handling |
| Remote validated, no local | Inspect/track without force; PR handling |
| Remote validated, no relevant PR | Create PR |
| Divergent local/remote tips | Hard refuse |
| Invariant failure | Hard refuse |
| Dirty pre-commit tree | Refuse; manual restore |
| Main advanced; still valid; tips agree | Resume per rules |
| Ambiguous main advancement | Hard refuse |

### `tag` fresh vs resume

Shared: clean worktree; `HEAD ==` remote main tip; package version match;
helper `--verify-release --print-release-date` (+ optional
`--verify-release-date`); remote tag probe found/absent/failed.

- **Remote tag found:** hard-refuse (investigation-required). Never
  force-move/delete.
- **Remote probe failed:** fail closed.
- **Fresh** (remote absent, no local tag): `--execute` creates
  `git tag -a -s "v<version>" -m "v<version>"` at `HEAD`; push only with
  `--push`. Signing failure leaves no lightweight tag. Creation prechecks
  ensure verify tooling will be able to validate (fail closed if signing
  cannot produce a verifiable tag).
- **Resume** (local tag exists, remote absent): validate name `v<version>`;
  annotated (not lightweight); `git verify-tag` exit `0`; points at current
  `HEAD`; `HEAD` still remote main tip; message exactly `v<version>`; package +
  helper verify still pass. Without `--push`: report exists, success. With
  `--push --execute`: push that tag only. Never recreate/move/delete/force.
- **Invalid local tag:** hard-refuse.

### Documentation (`RELEASING.md`)

Document operator flow; exact assert flags (`--verify-release`,
`--verify-release-date`, `--print-release-date` vs `--release-date`); signature
policy (crypto validity only); prepare/tag fresh/resume; PR states; ls-remote
exit classification; local-tag-then-push.

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
tip; later-UTC-day tag. Live signing/`gh`/push remain operator gates.

## Risks and Considerations

- Fixed `--print-release-date` line contract avoids JSON-vs-text ambiguity for
  implementers.
- Separate `--verify-release-date` avoids overloading prep `--release-date`.
- Crypto-validity-only signing is weaker than maintainer authorization; stated
  explicitly so operators are not misled. Environment `release` reviewers remain
  the publish gate.
- SSH verify depends on local `allowedSignersFile`; missing config fails closed
  rather than skipping.
- ls-remote exit `2` is the only “absent” signal; treating other nonzeros as
  absent would proceed under outages.
- Remote tag presence stays non-resumable automatically.
- PR lookup must include closed/merged to avoid duplicate replacements.

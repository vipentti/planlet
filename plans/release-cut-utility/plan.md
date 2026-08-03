# Release-cut maintainer utility

## Summary

Add a dependency-free maintainer script, `scripts/release.mjs`, with two
subcommands — `prepare` (changelog cut, version alignment, signed release
commit, branch push, PR into `main`) and `tag` (signed annotated tag, optional
push). Remote publishing stays with the environment-gated `release.yml`.

Governing contract:

> The utility automates the happy path and fails safely when it encounters
> existing or ambiguous state. It does not repair or resume interrupted
> preparation; the maintainer resolves that state manually and reruns the
> command.

This is a solo-maintainer tool for an infrequent workflow. It deliberately has
no resume mode, no reconciliation, and no concurrency machinery.

## Scope

### Goal

Collapse the manual `RELEASING.md` operator steps into two commands that fail
closed before anything irreversible, while keeping PR review and the
post-merge tag as deliberate human gates.

### Non-goals

- Resuming, repairing, reconciling, or continuing an interrupted `prepare`.
- Reconstructing a release commit from a branch or from PR metadata.
- Auto-merge, automatic post-merge tagging, or local `npm publish`.
- Version selection, semver inference, or changelog prose generation.
- Moving, replacing, deleting, or force-updating any branch or tag.
- Changing `release.yml`, Environment `release`, tag rulesets, or trusted
  publishing.
- New runtime dependencies, or any product-CLI / skill / planlet change.
- Maintainer allowlists for signatures (Git's verification is the check).
- Perfect atomicity against concurrent pushers — see Shared safety rules.

## Approach

### CLI

```sh
npm run release:prepare -- --version X.Y.Z [--release-date D] [--execute]
npm run release:tag     -- --version X.Y.Z [--release-date D] [--execute] [--push]
```

- npm aliases only: `release:prepare` and `release:tag`.
- `--version` required. `--execute` enables mutations. `--push` is `tag`-only
  and still requires `--execute`.
- Dry-run is the default.
- Unknown flags, duplicate value flags, and a missing/malformed subcommand fail
  with usage on stderr.
- Subprocess failures name the failed operation and include enough stderr to
  recover, without echoing credentials.

#### Operator workflow

1. `npm run release:prepare -- --version X.Y.Z` (dry-run), then `--execute`.
2. Review and merge the opened PR into `main`. No auto-merge. The merge may
   land on a later UTC day.
3. Update the checkout so `HEAD` equals the current remote `main` tip, then
   `npm run release:tag -- --version X.Y.Z --execute`, and rerun with `--push`
   when ready (or pass both at once).

### Shared safety rules

- **Dry-run mutates nothing**: not the worktree, index, local branches or tags,
  any local ref, any remote ref, or PR state. Read-only remote queries
  (`git ls-remote`, `gh` reads) are allowed. Dry-run prints the planned files
  and versions to change, branch name, commit message, PR action, tag name and
  target, and push action.
- **Clean worktree required** before any mutation.
- **`HEAD` must equal the current remote `main` tip** for fresh `prepare` and
  for `tag`.
- **Verify before push.** A newly created commit or tag is verified with
  `git verify-commit` / `git verify-tag` before any push. There are no
  preliminary signing-configuration probes — creating the object and verifying
  it is the authoritative check. GPG and SSH both work through Git's normal
  verification; no allowlist.
- **Pre-existing state is refused, not adopted.** Probe the exact remote ref
  before pushing and refuse if it already exists.
- **Push explicitly, never with `--force`:**

```sh
git push origin <commit-sha>:refs/heads/release/v<version>
git push origin refs/tags/v<version>:refs/tags/v<version>
```

  After pushing, verify the exact remote ref now points at the expected commit
  or tag object.

- **Residual race, accepted.** Probe-then-push is not atomic: another actor
  could create the ref in between, and an ordinary push may fast-forward or
  report up-to-date rather than failing. That window is accepted deliberately —
  this is a solo-maintainer, infrequent release process, and the post-push ref
  verification catches the outcomes that matter. Closing it fully would require
  lease-and-porcelain machinery this plan explicitly rejects.

#### Remote-ref probes

Probe exact refs with `git ls-remote --exit-code`:

| Result | Condition |
| --- | --- |
| Found | Exit `0` with a match for the exact ref name (for annotated tags, the `refs/tags/vX` + `refs/tags/vX^{}` pair is one match) |
| Absent | Exit `2` |
| Failed | Any other exit status, or malformed output |

Prefix matches (`v1.2` when asking for `v1.2.0`) never count as found. Never
infer absence from stderr text. A failed probe, or an absent remote `main`,
fails closed.

### `prepare`

#### Guards (before any edit)

Refuse, with recovery guidance, when any of these hold:

| Condition | Message |
| --- | --- |
| Local `release/v<version>` exists | Branch exists; resolve or delete it, then rerun |
| Remote `release/v<version>` exists | Show the ref and the related PR when available; resolve manually |
| Matching **open** PR | Print URL; preparation already in progress |
| Matching **merged** PR | Version already prepared — refuse even when the head branch was deleted |
| Matching **closed-unmerged** PR | Refuse; manual action required |
| Multiple or conflicting PR matches | Refuse with manual-investigation guidance |
| `package.json.version` already equals `--version` | Already prepared; refuse |
| Changelog already contains that release | Already prepared; refuse |
| Remote tag `v<version>` exists | Already released; refuse |
| Worktree dirty, or `HEAD` ≠ remote `main` tip | Refuse |

PR matching is by exact head `release/v<version>` and base `main`, over open,
closed, and merged PRs. Classification goes no further than the table above —
enough to prevent duplicate fresh preparation, and nothing more. The merged-PR
guard is the only deleted-branch protection needed.

#### Flow

```text
guards (above)
→ cut the changelog release section (date defaults to today UTC)
→ set package.json.version, package-lock.json.version,
   and package-lock.json.packages[""].version to <version>
→ validate the edited worktree:
     node scripts/assert-changelog-release-ready.mjs --release-date <D>
     plus all three root version fields equal <version>,
     with packages[""] present as an object
→ git commit -S -m "release: <version>" on branch release/v<version>
→ resolve the exact new commit SHA
→ post-commit checks on that SHA (Git plumbing):
     message exactly "release: <version>"
     exactly one parent
     git verify-commit <sha> exits 0
     changed paths are only CHANGELOG.md, package.json, package-lock.json
→ probe the remote branch ref; refuse if it now exists
→ git push origin <sha>:refs/heads/release/v<version>
→ verify the remote ref points at <sha>
→ gh pr create (base main) — only after a successful push
```

The version fields are updated through npm's supported version behavior when
that touches only the intended root fields; otherwise through minimal direct
JSON edits matching the repository's formatting. Dependency entries are never
rewritten.

Since there is no resume mode, the worktree *is* the thing being validated —
there is no candidate-versus-ambient ambiguity, and no blob extraction to a
temporary directory.

#### On failure

If any post-commit check fails: no push, no PR. Leave the local branch and
commit untouched — no reset, rewrite, or delete. The error states that the
commit was created locally but not pushed, and names what failed. The
maintainer inspects, fixes or deletes the branch, and reruns.

### `tag`

Shared preconditions: clean worktree; `HEAD` equals the current remote `main`
tip; `package.json.version` equals `--version`; the changelog validates as a
released version via the helper's historical mode; the remote tag probe
succeeds. **A remote tag that already exists is always a refusal** — never
moved, replaced, or overwritten.

#### Fresh local tag

```text
preconditions → git tag -a -s "v<version>" -m "v<version>" HEAD
→ git verify-tag v<version>
→ if --push: probe remote tag absent → git push origin refs/tags/v<version>:refs/tags/v<version>
→ verify the remote tag points at the expected tag object
```

If verification fails, the local tag stays in place for inspection and nothing
is pushed.

#### Existing local tag (the two-step workflow)

When the exact local tag exists and the remote tag does not, validate it:
annotated (not lightweight); name exactly `v<version>`; message exactly
`v<version>`; target equals current `HEAD`; `git verify-tag` exits `0`.

- Without `--push`: report that it is ready.
- With `--execute --push`: push it, then verify the remote ref.

Any other local-tag state is refused. The tag is never moved, recreated,
replaced, deleted, or force-updated automatically.

### Assertion-helper extension

`scripts/assert-changelog-release-ready.mjs` stays the **only** changelog
parser. `release.mjs` never parses the changelog itself.

Existing preparation mode is unchanged:

```sh
--release-date YYYY-MM-DD    # strict, rejects past dates
```

Add a compact historical mode:

```sh
--verify-release                       # validate an existing release, no past-date rule
--verify-release --date YYYY-MM-DD     # recorded date must equal D
--verify-release --print-date          # stdout is exactly YYYY-MM-DD\n
```

Historical mode requires exactly one empty `[Unreleased]` section, exactly one
section matching the current `package.json` version with a valid date, and
non-empty notes.

Parser rules: verification-only options require `--verify-release`; preparation
and historical modes cannot be combined; unknown flags and duplicate value
flags fail. Validation and usage errors write diagnostics to stderr and exit
nonzero, with empty stdout. Ordinary CI behavior (no date flags) is unchanged.

The helper already accepts optional `CHANGELOG.md` and `package.json`
positional paths; that stays as-is.

### Failure and recovery behavior

Every refusal names the state found and what the maintainer should do. The
utility never repairs, reconstructs, reconciles, or resumes.

| Situation | Recovery |
| --- | --- |
| Release branch exists locally or remotely | Inspect it; merge, delete, or rename it; rerun |
| Open PR exists | Finish reviewing and merging it |
| Merged PR exists | Version already released; pick the next version |
| Closed-unmerged PR exists | Decide deliberately; delete stale refs; rerun |
| Commit created but verification failed | Inspect the branch; fix signing; delete the branch and rerun |
| Push rejected | Re-probe; resolve the remote state manually |
| Tag created but verification failed | Inspect it; delete it manually and rerun |
| Remote tag exists | Already released, or investigate |

## Tests

Fixture and subprocess tests using temp repos, bare local remotes, and stubbed
`gh` and signing. CI never needs live GitHub or real operator keys. No
elaborate concurrency fixtures.

- Dry-run performs no mutations.
- Fresh `prepare` succeeds end to end.
- Local or remote release branch already exists → refuse.
- Matching open / merged / closed PR each prevent duplicate fresh preparation.
- All three root version fields are updated, and validated.
- Malformed or inconsistent package/lockfile data refuses (stale
  `package-lock.json.version`, stale `packages[""].version`, missing or
  non-object `packages[""]`).
- Commit signature verifies before push; verification failure causes no push
  and leaves the local commit.
- The commit changes only the intended release files.
- Branch push rejection is reported safely.
- PR creation happens only after a successful push.
- Historical changelog validation, and the exact `YYYY-MM-DD\n` printed date.
- Preparation mode still rejects past dates; CI mode unchanged.
- Tag creation and signature verification; verification failure causes no push.
- The local-tag two-step flow.
- Remote tag already exists → refuse.
- Tag push rejection, or an unexpected post-push ref, fails.
- No force push, tag movement, auto-merge, or local publish ever occurs.

## Acceptance Criteria

- Dry-run mutates nothing; `--execute` gates every mutation; `--push` is
  `tag`-only.
- Fresh `prepare` and `tag` require a clean worktree and `HEAD` equal to the
  remote `main` tip.
- Pre-existing branch, tag, or PR state is refused with guidance — never
  adopted, repaired, or resumed.
- All three root version fields are written and verified.
- Commit and tag are verified after creation and before any push; failure
  leaves local state intact and pushes nothing.
- Pushes are explicit and non-force; the remote ref is verified afterwards.
- The assertion helper remains the sole changelog parser and can validate an
  existing release and print its date.
- `RELEASING.md` documents the happy path, manual recovery, and that there is
  no automatic prepare resume.
- No auto-merge, no local publish, no new dependencies, `release.yml`
  unchanged.

## Verification

Repository suite, in order:

```sh
npm run format:check
npm run lint
npm run type-check
npm run build
npm test
git diff --check
```

## Risks and Considerations

- Probe-then-push leaves a small race window. Accepted deliberately for a
  solo-maintainer workflow; post-push ref verification is the backstop.
- Refusing rather than resuming means an interrupted `prepare` needs manual
  cleanup. That is the intended trade: recovery guidance in the error message
  is cheaper and safer than a resume state machine.
- Verifying the object after creation, rather than probing signing config
  beforehand, is what actually proves the release object is signed and valid.
- Checking only `package-lock.json.version` would miss a stale
  `packages[""].version`; all three root fields are required.
- Crypto-validity-only signing does not prove the signer is an authorized
  maintainer. Environment `release` reviewers remain the publish gate.

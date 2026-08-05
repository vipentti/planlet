# Releasing Planlet

Changelog upkeep and the branch-triggered npm / GitHub release flow for
`@vipentti/planlet`. For product usage, see [`README.md`](README.md).

The archived
[`plans/completed/2026-08-03-release-automation/plan.md`](plans/completed/2026-08-03-release-automation/plan.md)
records the earlier tag-triggered workflow contract and remains historical
record. Current behavior is described in this file.

## Changelog

Record user-visible changes under `Unreleased` in [`CHANGELOG.md`](CHANGELOG.md).
At release time, move those entries into a dated version section and restore an
empty `Unreleased` section. Ordinary CI runs
`node scripts/assert-changelog-release-ready.mjs`, which requires exactly one
`[Unreleased]` section and at most one structurally valid dated section for the
current `package.json` version. Malformed headings that mention `Unreleased` or
that version still count toward those limits. Explicit release verification uses
the helper's historical mode:

```sh
node scripts/assert-changelog-release-ready.mjs --verify-release [--date YYYY-MM-DD] [--print-date]
```

`--verify-release` has no not-in-the-past rule; `--print-date` writes exactly
`YYYY-MM-DD\n` to stdout on success.

From a source checkout, use `node scripts/changelog.mjs <version>` to extract
release notes; that helper is not included in the published npm package.

## Normal release flow

The routine release is fully scripted after one maintainer command:

1. Prepare the release PR:

   ```sh
   npm run release:prepare -- --version X.Y.Z --execute
   ```

2. Review and merge the generated `release/vX.Y.Z` PR into `main`. Do not tag
   manually and do not merge another release PR before this release completes.
3. Inspect the pending workflow deployment: the `Release` workflow's `detect`
   job classifies the push, and a version-changing release merge starts a
   pending deployment on the GitHub Environment `release`.
4. Approve the `release` environment. The protected `release` job then creates
   and pushes the annotated GPG-signed `vX.Y.Z` tag at the exact merged commit,
   publishes the verified package to npm with provenance, and creates or
   updates the GitHub release.
5. Verify the result: the signed tag, the npm package and its provenance, and
   the GitHub release notes.

The changelog's dated section is the **release-cut date** written by
`release:prepare`, not the publication date. The workflow validates it through
the helper's historical mode, so environment approval crossing UTC midnight
never fails a valid release.

## Scripted release cut

The repository ships a dependency-free maintainer utility
`scripts/release.mjs` with two subcommands, `prepare` and `tag`. `prepare` is
the routine command; `tag` is retained as break-glass/recovery and is no longer
part of the normal happy path. The utility automates the happy path and fails
safely when it encounters existing or ambiguous state; it never repairs,
resumes, or reconciles interrupted preparation. If `prepare` leaves partial
state, resolve it manually (see [Recovery](#recovery)) and rerun — there is
**no automatic prepare resume**.

Both commands are dry-run by default and require `--execute` to mutate anything.
Each requires a clean worktree and local `HEAD` equal to the remote `main` tip.

### Prepare

```sh
npm run release:prepare -- --version X.Y.Z          # dry-run
npm run release:prepare -- --version X.Y.Z --execute
```

`prepare --release-date D` writes date `D` (validated strictly, not in the
past); the default is today UTC. `prepare` cuts the changelog release section,
sets the three root version fields in `package.json` and `package-lock.json`,
creates a signed commit `release: <version>` on branch `release/v<version>`, and
opens a PR into `main`. It verifies the commit signature and commit contents
before and after the commit, refuses on any existing branch, tag, or matching
PR, and creates the PR only after a successful explicit non-force push. On
success it checks out local `main` again so a post-merge fast-forward is
one pull away.

After the PR is reviewed and merged, the branch-triggered `Release` workflow
takes over. Do not push a tag manually.

### Tag (break-glass)

```sh
npm run release:tag -- --version X.Y.Z --execute            # create local tag
npm run release:tag -- --version X.Y.Z --execute --push     # push it
```

`release:tag` is recovery tooling only. It refuses an already-existing remote
tag, so it is only usable before the workflow pushes `v<version>`. It requires
`HEAD` to equal the remote `main` tip, resolves the recorded changelog date
through the helper's historical mode, creates an annotated signed tag, verifies
it locally, and only pushes with an explicit `--push`. If the automatic flow
cannot run (for example, workflow or environment misconfiguration), an operator
can create and push the tag this way; a later workflow rerun then finds the
exact tag, verifies it, and continues publication.

### Recovery

Out-of-scope or ambiguous state is refused with guidance, never adopted or
fixed. Common cases:

- A `release/v<version>` branch or open PR already exists: finish reviewing and
  merging it, or delete the stale ref, then rerun.
- A merged PR for that version exists (or the tag already exists): the version
  is already handled — pick the next version.
- A signed commit was created but post-commit validation failed (exact message,
  single parent, signature, allowed changed paths, or clean state): a commit
  hook may have rewritten a release file. Inspect the branch, resolve or delete
  it manually, then rerun.
- A push was rejected or the pushed ref does not match: re-probe and resolve the
  remote state manually.
- The release workflow failed after the tag was pushed: fix the failure and
  rerun the workflow; the rerun verifies the existing exact tag instead of
  recreating it.

## Branch-triggered release workflow

The `Release` workflow runs on every push to `main` and uses a dependency-free
Node detector (`scripts/detect-release-merge.mjs`) to classify the push. An
ordinary push (version unchanged) completes without environment approval, does
not read release secrets, and creates no tag, npm package, or GitHub release.
A version-changing push must change exactly `CHANGELOG.md`, `package.json`, and
`package-lock.json`, keep the three root version fields in agreement, use a
stable `X.Y.Z` version greater than the previous one, and carry a valid dated
changelog section with empty `[Unreleased]`. Malformed or missing previous
SHAs, mismatched files, invalid versions, or nonempty unreleased notes fail
closed rather than being treated as an ordinary push.

Only the protected `release` job references `environment: release` and only its
steps read the release secrets. The job checks out the exact triggering commit
with full history, verifies it is reachable from the current `origin/main`,
creates and pushes the signed tag, verifies GitHub reports the signature, runs
the full repository verification suite, packs the exact artifact with
`npm pack --json --ignore-scripts`, publishes through npm trusted publishing
with provenance (or verifies an already-published version by exact identity and
integrity), and creates or updates the GitHub release from the committed
changelog notes. Pushing the tag does not start a second workflow run.

Rerun behavior:

- Remote tag absent: the job creates it locally, verifies the signature, pushes
  only that ref, and verifies the remote object.
- Remote tag present: the job fetches it and requires an annotated tag object
  pointing at the exact triggering commit with a verified signature; any
  mismatch fails without mutation.
- npm version already published: treated as success only when registry identity
  and packed-artifact integrity match the source; otherwise the job fails.
- GitHub release already exists: updated from the changelog notes.

Merging another release PR before the previous release completes is
**unsupported**. Workflow runs are serialized, but two overlapping version
bumps cannot be reconciled automatically.

## Required environment configuration

The `release` GitHub Environment must provide these secrets:

| Secret                    | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `RELEASE_GPG_PRIVATE_KEY` | ASCII-armored private key of the dedicated release-only GPG key        |
| `RELEASE_GPG_PASSPHRASE`  | Passphrase for that private key                                        |
| `RELEASE_PUSH_TOKEN`      | Fine-grained token for pushing the signed tag only; never used for npm |

And these variables:

| Variable                  | Purpose                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `RELEASE_GPG_FINGERPRINT` | Exact fingerprint of the imported secret key; the workflow fails if it does not match               |
| `RELEASE_GIT_NAME`        | Git committer/tagger name for the release tag                                                       |
| `RELEASE_GIT_EMAIL`       | Email configured for the tag; must be a verified email on the GitHub account holding the public key |

The signing key must be a dedicated release-only GPG key. Its email must be
verified on the GitHub account that holds the public key, so GitHub reports the
tag signature as verified. The workflow imports the key into an isolated
temporary GPG home, verifies the fingerprint exactly, signs in batch mode with
loopback pinentry, and removes the key material in an `always()` cleanup step.
The private key is used for release tags only, never for commits.

`RELEASE_PUSH_TOKEN` must be a fine-grained token scoped to `vipentti/planlet`
with repository Contents read/write. The repository's `v*` tag ruleset
restricts tag creation, so the token actor must be allowed to create `v*` tags
under that ruleset; tag updates, force changes, and deletions remain prohibited
and the workflow never attempts them. A dedicated GitHub App added to the
ruleset bypass list is the preferred future replacement for a maintainer PAT and
is not required for this flow. A tag push rejected by repository rules fails
the job with git's diagnostic.

## Key rotation

To rotate the signing key:

1. Generate a new dedicated GPG key pair whose email is verified on the GitHub
   account holding the public key, and add the public key to that account.
2. Update `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_PASSPHRASE` secrets and
   `RELEASE_GPG_FINGERPRINT` in the `release` environment.
3. Confirm the fingerprint variable exactly matches the imported key; the
   workflow fails the release if it does not.
4. After a successful release with the new key, remove the old private key from
   the environment and the old public key from the GitHub account.

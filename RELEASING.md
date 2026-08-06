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
current `package.json` version; every changelog section must also have a link
reference. Malformed headings that mention `Unreleased` or that version still
count toward those limits. Explicit release verification uses the helper's
historical mode:

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
exact tag, verifies it, and continues publication. Break-glass tags must use
the canonical `Release v<version>` subject and the same dedicated release-only
signing key identified by `RELEASE_GPG_FINGERPRINT`; the workflow's isolated
GPG keyring can only verify a tag signed by that exact key.

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
changelog section with empty `[Unreleased]`. The detector also requires the
fixed package identity `@vipentti/planlet` in `package.json.name`,
`package-lock.json.name`, and `package-lock.json.packages[""].name`, so package
and lockfile names are validated before any environment approval. Malformed or
missing previous SHAs, mismatched files, invalid versions, mismatched names,
or nonempty unreleased notes fail closed rather than being treated as an
ordinary push.

The workflow is split into three jobs. `detect` (unprivileged) classifies the
push. `verify` (unprivileged, `contents: read` only, no npm OIDC capability)
checks out the exact triggering SHA, verifies ancestry, and runs `npm ci`,
`format:check`, `lint`, `type-check`, `build`, tests, `git diff --check`,
generated-skill parity, and the clean-source check. `release` is the only
protected job (`environment: release`, `contents: write`, and the only job with
`id-token: write`); it depends on both prior jobs succeeding and installs no
project dependencies and executes no repository-owned scripts or code from
`node_modules`. It uses a pinned official Node/npm toolchain (Node `24.11.1`
with bundled npm `11.6.2`), inline workflow-owned validation, and system tools
only; repository files are read and packaged as data, never executed. It
performs a fresh origin/main ancestry check after approval and repeats the
release-intent check (ancestry + unchanged release-control files) immediately
before creating a new tag. It extracts release notes inline, downloads the
immutable artifact produced by `verify` (packed with `npm pack --json
--ignore-scripts`, validated, and smoke-tested there), and revalidates its
SHA-256, npm integrity, CLI presence, and package contract before any
mutation — it never runs `npm pack` itself. It then runs GPG
verification/signing (public-key-only when an exact remote tag already exists;
private-key signing only when a new tag must be created), App-authenticated
tag push, GitHub signature confirmation, npm publish-or-verify (lifecycle
scripts disabled for packing and publication), and GitHub release steps. The
remote tag is the final irreversible mutation before npm publication; pushing
it does not start a second workflow run. Exact step details live in
[`.github/workflows/release.yml`](.github/workflows/release.yml).

The protected workflow keeps minimal tag verification inline intentionally: it
cannot execute repository-owned scripts at its trust boundary.
`scripts/verify-release-tag.mjs` belongs to the break-glass `release.mjs` path;
it is not shared with the protected workflow.

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

| Secret                    | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `RELEASE_GPG_PUBLIC_KEY`  | ASCII-armored public key of the dedicated release-only GPG key  |
| `RELEASE_GPG_PRIVATE_KEY` | ASCII-armored private key of the dedicated release-only GPG key |
| `RELEASE_GPG_PASSPHRASE`  | Passphrase for that private key                                 |
| `RELEASE_APP_PRIVATE_KEY` | PEM private key of the dedicated Release Automation GitHub App  |

And these variables:

| Variable                  | Purpose                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `RELEASE_APP_ID`          | GitHub App ID of the Release Automation App                                                         |
| `RELEASE_GPG_FINGERPRINT` | Exact fingerprint of the imported secret key; the workflow fails if it does not match               |
| `RELEASE_GIT_NAME`        | Git committer/tagger name for the release tag                                                       |
| `RELEASE_GIT_EMAIL`       | Email configured for the tag; must be a verified email on the GitHub account holding the public key |

The signing key must be a dedicated release-only GPG key. Its email must be
verified on the GitHub account that holds the public key, so GitHub reports the
tag signature as verified. The workflow initializes an isolated temporary GPG
home and splits key material by execution path: when an exact remote tag
already exists, it imports **only** `RELEASE_GPG_PUBLIC_KEY` for verification
(no passphrase file, no signing wrapper, no private key loaded); when a new
tag must be signed, it imports `RELEASE_GPG_PRIVATE_KEY`, verifies the exact
fingerprint, and signs in batch mode with a loopback-pinentry wrapper. Both
paths verify the imported key fingerprint against `RELEASE_GPG_FINGERPRINT`,
and the `always()` cleanup step removes the temporary home. The private key is
used for release tags only, never for commits.

Tag push authentication uses a dedicated **Release Automation GitHub App**; the
App does not replace the GPG signing key. The repository owner must configure
externally:

1. Create or reuse a private Release Automation GitHub App.
2. Grant the App repository Contents read/write.
3. Install the App only on `vipentti/planlet`.
4. Configure **two separate active `v*` tag rulesets**:
   - **`release-tag creation`**: target tags matching `v*`; enable **Restrict
     creations**; add the Release Automation App to **this ruleset's** bypass
     list (normal always-allow bypass mode, required for direct tag creation).
     This is the only tag ruleset the App may bypass.
   - **`release-tag immutability`**: target tags matching `v*`; enable
     **Restrict updates**, **Restrict deletions**, and **Block force pushes**;
     do **not** include the App in the bypass list (prefer an empty bypass
     list).
5. Store the App ID as the `RELEASE_APP_ID` variable in the `release`
   environment.
6. Store the App PEM private key as the `RELEASE_APP_PRIVATE_KEY` secret in the
   `release` environment.

**The Release Automation App receives a tag-creation bypass only. It must never
bypass the ruleset that prevents updates, force changes, and deletions of
existing release tags.**

The workflow generates a short-lived installation token per approved release
run, scoped to `vipentti/planlet` with Contents read/write only, and uses it
exclusively for the signed tag push. The action exposes the masked installation
token as its step output. The workflow passes that output directly to the
single tag-push step. It does not copy the token into custom `$GITHUB_OUTPUT`
or `$GITHUB_ENV` values, files, artifacts, logs, remote URLs, or persistent Git
configuration. The action revokes the token in its post step. The token is
never used for npm and never used for GitHub release operations (those use
`GITHUB_TOKEN`). A tag push rejected by repository rules fails the job with
git's diagnostic. A maintainer fine-grained PAT is not workflow configuration;
it is only a last-resort manual recovery option.

## Main-only release environment policy

The `release` GitHub Environment must restrict deployments to `main`: under
GitHub Environment settings, set **Deployment branches and tags** to
**Selected branches and tags** with **Allowed branch: `main`**. The workflow's
own `push: main` trigger is **not sufficient** — another workflow file on
another branch could reference `environment: release` and start a protected
release run. The Environment-level branch restriction is the authorization
boundary. **Referencing `environment: release` does not itself require
approval.** The live Environment must also configure **Deployment protection:
at least one Required reviewer**, with one reviewer approval before the
protected job begins; otherwise the protected job starts automatically after
verification.

Optional policy choices, applied by the repository owner as appropriate:

- Enable **Prevent self-review** only when another reliable release approver
  exists. It is not required for a sole maintainer.
- Restrict **Allow administrators to bypass required reviewers** when stronger
  dual control is desired and an acceptable recovery process exists for an
  unavailable approver.

These Environment settings are applied manually through GitHub; the repository
never changes live Environment configuration.

## Key rotation

To rotate the signing key:

1. Generate a new dedicated GPG key pair whose email is verified on the GitHub
   account holding the public key, and add the public key to that account.
2. Change all four values **together** in the `release` environment:
   `RELEASE_GPG_PUBLIC_KEY`, `RELEASE_GPG_PRIVATE_KEY`,
   `RELEASE_GPG_PASSPHRASE`, and `RELEASE_GPG_FINGERPRINT`. The public and
   private values must belong to the same dedicated release key, and the
   configured fingerprint must match that key.
3. Confirm the fingerprint variable exactly matches the imported key; the
   workflow fails the release if it does not.
4. Do not start a release while the four values are inconsistent. Existing-tag
   reruns verify with `RELEASE_GPG_PUBLIC_KEY`; new-tag runs use the private
   key and passphrase. Rotating only the private key and fingerprint breaks
   existing-tag verification.
5. After a successful release with the new key, remove the old private key from
   the environment and the old public key from the GitHub account.

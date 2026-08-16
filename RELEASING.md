# Releasing Planlet

Changelog upkeep and the kit-owned npm release flow for `@vipentti/planlet`.
For product usage, see [`README.md`](README.md).

The archived [`plans/completed/2026-08-03-release-automation/plan.md`](plans/completed/2026-08-03-release-automation/plan.md) records the earlier bespoke release contract and remains historical record. Current behavior is described in this file.

## Changelog

Record user-visible changes under `Unreleased` in [`CHANGELOG.md`](CHANGELOG.md).
At release time, the kit cuts those entries into a dated version section and restores an empty `Unreleased` section on the release branch. Ordinary CI runs `node scripts/assert-changelog-release-ready.mjs` (no flags), which requires exactly one `[Unreleased]` section and at most one structurally valid dated section for the current `package.json` version; every changelog section must also have a link reference. Malformed headings that mention `Unreleased` or that version still count toward those limits.

From a source checkout, use `node scripts/changelog.mjs <version>` to extract release notes; that helper is not included in the published npm package. The reusable workflow validates the dated section via the kit's own historical checks, so environment approval crossing UTC midnight never fails a valid release.

## Normal release flow (kit)

The routine release is fully scripted after one maintainer command using the kit CLI:

1. Verify prerequisites (dry-run, lists every problem):

   ```sh
   npx npm-release-flow check
   ```

   Checks `CHANGELOG.md` with bare `## [Unreleased]`, `release:verify` script, committed `package-lock.json`, the four `NPM_RELEASE_FLOW_*` secrets and variables, the `release` Environment with required reviewer, the Release App installation, local `gh`/`git` identity and signing preflights.

2. Prepare the release PR:

   ```sh
   npx npm-release-flow prepare --version X.Y.Z --execute
   ```

   Dry-run is default; `--execute` performs mutations. Cuts the changelog at today UTC (`todayUtc()`), bumps the three version fields, commits `release: X.Y.Z` signed with the release key, pushes `release/vX.Y.Z` and opens the PR carrying `Kit: @vipentti/npm-release-flow@<kit-version>`. The cut date is always today UTC; there is no `--release-date` flag.

3. Review and merge the generated `release/vX.Y.Z` PR into `main` via squash. Do not tag manually and do not merge another release PR before this release completes. Keep the exact three-file allowlist (`CHANGELOG.md`, `package.json`, `package-lock.json`); `plans/*` task-state changes must not ride the release PR per `plans/npm-release-flow-migration/plan.md` exception — record `planlet task check` after the merge in the next ordinary push.

4. Watch the reusable workflow `vipentti/npm-release-flow/.github/workflows/release.yml@<40-hex>` (thin caller `.github/workflows/release.yml` with `permissions: {}`, `concurrency: {group: release-main, cancel-in-progress: false, queue: max}`, explicit `secrets: NPM_RELEASE_FLOW_*`). `detect` classifies the push, `verify` runs `npm ci` plus `npm run release:verify` plus pack-contract and handoff, `release` (environment `release`, `permissions: contents: write, pull-requests: read, id-token: write`) revalidates, creates and pushes the annotated GPG-signed tag `vX.Y.Z` as the App, publishes with Trusted Publishing and provenance, and creates the GitHub Release.

5. Verify the result: the signed tag (`git verify-tag --raw` and GitHub `verification.verified`), the npm package with provenance, and the GitHub Release notes.

## Kit CLI reference

```sh
npx npm-release-flow check --help
npx npm-release-flow prepare --version X.Y.Z          # dry-run
npx npm-release-flow prepare --version X.Y.Z --execute
npx npm-release-flow tag --version X.Y.Z --execute    # manual tag only when workflow cannot run
```

- Every command is dry-run by default; `--execute` enables mutations.
- `prepare` never auto-resumes; resolve a half-created branch/PR manually before retry.
- `tag` refuses an existing remote tag and is for recovery only; the normal path is the workflow.

## Thin caller contract

Single encoding in `.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    branches: [main]
permissions: {}
concurrency:
  group: release-main
  cancel-in-progress: false
  queue: max
jobs:
  release:
    uses: vipentti/npm-release-flow/.github/workflows/release.yml@2ffb0fc02d7c977fe1dc89d3102fa8850030176e
    permissions:
      contents: write
      pull-requests: read
      id-token: write
    secrets:
      NPM_RELEASE_FLOW_GPG_PRIVATE_KEY: ${{ secrets.NPM_RELEASE_FLOW_GPG_PRIVATE_KEY }}
      NPM_RELEASE_FLOW_GPG_PASSPHRASE: ${{ secrets.NPM_RELEASE_FLOW_GPG_PASSPHRASE }}
      NPM_RELEASE_FLOW_GPG_PUBLIC_KEY: ${{ secrets.NPM_RELEASE_FLOW_GPG_PUBLIC_KEY }}
      NPM_RELEASE_FLOW_APP_PRIVATE_KEY: ${{ secrets.NPM_RELEASE_FLOW_APP_PRIVATE_KEY }}
```

- Top-level `permissions: {}`; job `release` carries `contents: write, pull-requests: read, id-token: write`.
- Pin is a full 40-char SHA for the kit version; advance it together with the exact `devDependency` `@vipentti/npm-release-flow` in one ordinary upgrade PR, never inside a release PR.
- GitHub reruns preserve the original commit SHA and its associated workflow/source, so pre-migration commits retain their own scripts without needing a coexistence window.

## Required environment configuration (kit)

Repository-level Actions configuration (not environment-level) must provide these secrets and variables. Values are write-only on GitHub; each is sourced from the local release identity outside GitHub:

| Secret                             | Source outside GitHub                            |
| ---------------------------------- | ------------------------------------------------ |
| `NPM_RELEASE_FLOW_GPG_PRIVATE_KEY` | `gpg --export-secret-keys --armor <fingerprint>` |
| `NPM_RELEASE_FLOW_GPG_PUBLIC_KEY`  | `gpg --export --armor <fingerprint>`             |
| `NPM_RELEASE_FLOW_GPG_PASSPHRASE`  | passphrase store                                 |
| `NPM_RELEASE_FLOW_APP_PRIVATE_KEY` | Release Automation App private-key PEM           |

| Variable                           | Source / value                                       |
| ---------------------------------- | ---------------------------------------------------- |
| `NPM_RELEASE_FLOW_GPG_FINGERPRINT` | 40-hex primary fingerprint of the dedicated key      |
| `NPM_RELEASE_FLOW_APP_ID`          | GitHub App ID                                        |
| `NPM_RELEASE_FLOW_GIT_NAME`        | committer/tagger name for the release tag/commit     |
| `NPM_RELEASE_FLOW_GIT_EMAIL`       | verified email on the GitHub account holding the key |

Verify locally before cutting:

```sh
NPM_RELEASE_FLOW_GPG_FINGERPRINT=<fp> git config user.signingkey <fp>
NPM_RELEASE_FLOW_GPG_FINGERPRINT=<fp> NPM_RELEASE_FLOW_APP_PRIVATE_KEY="$(cat app.pem)" npx npm-release-flow check
gpg --list-secret-keys <fp>
```

The `release` Environment must have at least one required reviewer; the workflow otherwise starts without approval. The two `v*` tag rulesets remain active (`release-tag creation` with App bypass `always`, `release-tag immutability` without App bypass).

## Recovery

Out-of-scope or ambiguous state is refused with guidance, never adopted or fixed. Common cases:

- A `release/v<version>` branch or open PR already exists: finish reviewing and merging it, or delete the stale ref, then rerun `prepare`.
- A merged PR for that version exists (or the tag already exists): pick the next version.
- The release workflow failed after the tag was pushed: fix the failure and rerun the workflow; the rerun verifies the existing exact tag instead of recreating it.
- Prepare left partial state: inspect and manually resolve the half-created branch/PR before retry; there is no auto-resume. Workflow reruns reuse the original commit's workflow, so a stale pin blocks a fix until the release commit is reverted and recut.

## Main-only release environment policy

The `release` Environment must restrict deployments to `main` (`Deployment branches and tags` → `Selected branches and tags` → `Allowed branch: main`). The workflow's own `push: main` trigger is not sufficient; another workflow file on another branch could reference `environment: release` and start a protected run. The Environment-level branch restriction is the authorization boundary. **Referencing `environment: release` does not itself require approval.** The Environment must also have **Deployment protection: at least one Required reviewer**.

Optional: enable `Prevent self-review` only when another reliable approver exists.

These Environment settings are applied manually through GitHub; the repository never changes live Environment configuration.

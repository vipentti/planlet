# Release Automation

## Summary

Turn the publish-ready package produced by `packaging-and-polish` into a
released one. Add a hand-maintained `CHANGELOG.md` in
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format, a
tag-triggered GitHub Actions workflow that verifies, publishes to npm with
provenance through npm trusted publishing, and creates a GitHub release whose
notes come from the changelog.

## Scope

In scope:

- `CHANGELOG.md` at the repository root in Keep a Changelog 1.1.0 format:
  `## [Unreleased]` on top, versioned sections with ISO dates, standard change
  headings, and compare links at the bottom. Version 0.1.0 is backfilled from
  the completed planlets.
- `CHANGELOG.md` added to the `files` allowlist in `package.json` and to the
  Prettier globs, so it ships in the tarball and is covered by `format:check`,
  plus `CHANGELOG.md` added to the expected-files assertion in
  `tests/integration/packaging.test.ts`.
- `scripts/changelog.mjs`, which prints one version's release notes and exits
  non-zero when the section is missing or empty.
- A test that drives `scripts/changelog.mjs` as a subprocess against a fixture
  changelog.
- `.github/workflows/release.yml`, triggered by `v*` tags, running the full
  verification suite, a tag-versus-`package.json` version guard, notes
  extraction, `npm publish` with no long-lived token,
  `gh release create`, and rerun-safe behavior after a partial release.
- Release and changelog documentation in `AGENTS.md` and `README.md`.
- Making the GitHub repository public, a hard prerequisite for npm provenance.
- The manual bootstrap: publishing 0.1.0 by hand, creating its GitHub release,
  and connecting trusted publishing on npmjs.com, all before `release.yml`
  reaches the default branch.
- One real workflow-driven release, 0.1.1, as the only honest proof the
  workflow works.

Out of scope:

- Changesets, release-please, semantic-release, conventional-commit-derived
  versioning, and any automated version bump. Versions are chosen by a human.
- An `NPM_TOKEN` fallback path. Trusted publishing is the only authentication
  method this planlet configures.
- Prerelease channels, npm dist-tags other than `latest`, and yanking or
  deprecating published versions.
- Standalone Bun, Deno, or Go binaries, and signing beyond npm provenance.
- A dedicated changelog skill in any form. Changelog upkeep is a documented
  manual edit.
- Changes to planlet file semantics, lifecycle behavior, CLI commands, or the
  existing `ci.yml` workflow.

## Approach

Keep the changelog hand-written and make the machine check it. Generated
changelogs derive release notes from commit subjects, which describe changes to
the repository rather than changes users experience, and every generator brings
either a new dependency or a commit-message contract. A hand-maintained file in
a specified format costs one section edit per change, and
`scripts/changelog.mjs` turns it into the single source for GitHub release
notes, so a release with no changelog entry fails the workflow instead of
shipping empty notes.

Extract notes with a small script rather than inline YAML. A shell one-liner
buried in a workflow step cannot be tested and is only exercised during a
release, which is the worst moment to discover it is wrong.
`scripts/changelog.mjs` takes a version, prints that section's body without its
heading, and exits non-zero when the section is absent or contains no entries.
Test it by spawning it as a subprocess against a fixture, the way
`tests/integration/compiled-cli.test.ts` drives the bundle: the script is
JavaScript and the suite is TypeScript, and a subprocess boundary avoids
teaching `tsc` about `scripts/` for one import.

Trigger releases from `v*` tags. The tag is the human decision, and everything
after it is deterministic. The workflow re-runs the full documented suite before
publishing rather than trusting the CI run on the merge commit, because a tag
can point at any commit. A guard compares the tag to the `version` field in
`package.json` and fails on mismatch, which is the check that catches a
mistyped or stale tag before anything reaches the registry.

A tag alone is not evidence that the code was reviewed. Anyone with write access
— or anything holding a write token — can tag an arbitrary commit, and trusted
publishing would then ship it. So the workflow checks out with full history,
fetches the default branch explicitly, and fails unless the tagged commit is an
ancestor of `origin/main`, before the publish step:

```sh
# checkout only guarantees the tag ref; origin/main may not exist
git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
git merge-base --is-ancestor "$GITHUB_SHA" origin/main
```

Authenticate with npm trusted publishing rather than a stored token. OIDC
removes the long-lived credential entirely and produces a provenance
attestation in the same step. It requires `id-token: write` permission and
**npm ≥ 11.5.1**, which emits provenance automatically for OIDC publishes, so
the workflow installs a pinned-floor npm rather than relying on the version
bundled with `actions/setup-node`.

Provenance also requires a public repository and a public package. The
repository is private today, so it must be published before the bootstrap
release — nothing downstream works until it is.

Accept a manual first release, and order the bootstrap so no tag ever meets a
workflow that would republish it. Trusted publishing is configured on npmjs.com
against a package that already exists, and the name `planlet` is unregistered,
so 0.1.0 must be published by a human. The sequence is fixed:

1. Make the GitHub repository public.
2. Publish 0.1.0 from a workstation, tag `v0.1.0`, and create its GitHub
   release by hand, while `release.yml` does not yet exist on the default
   branch.
3. Configure the trusted publisher on npmjs.com naming this repository and
   `release.yml`.
4. Land this planlet's changes, including `release.yml`, on the default branch,
   and confirm CI is green on `main`.
5. Prepare 0.1.1 on `main` — bump `package.json` and the lockfile, promote
   `Unreleased` to a dated `0.1.1` section, update compare links, commit — then
   tag that exact commit and push `v0.1.1`.

Steps 2 and 4 must not be reordered. A `v0.1.0` tag pushed after `release.yml`
is live would trigger a publish of a version already on the registry. The 0.1.1
commit must reach `origin/main` before it is tagged, or the ancestry guard
rejects the release.

Make the release workflow rerun-safe. `npm publish` and `gh release create` are
separate steps, and a failure between them leaves a published version with no
GitHub release; rerunning then dies on a duplicate-version error before ever
reaching the release step. The publish step therefore skips publishing when the
exact version is already on the registry
(`if npm view planlet@<version> version >/dev/null 2>&1; then skip; fi`), and
the release step creates the GitHub release or updates it when it exists. That
is the whole recovery story: rerun the failed workflow.

Completion of this planlet spans the merge. T8 requires this branch to land on
`main`, and T9 tags from `main` afterwards, so archiving to `plans/completed/`
is a separate post-merge commit. The completion workflow should expect T8 and
T9 to be unchecked while this branch is open rather than treating that as
incomplete work.

## Acceptance Criteria

- `CHANGELOG.md` conforms to Keep a Changelog 1.1.0: `## [Unreleased]` first,
  versioned sections in reverse chronological order with `YYYY-MM-DD` dates,
  only the six standard change headings, no empty headings, and compare links
  for every version. This is reviewed by a human; the script checks only that a
  requested version's section exists and is non-empty.
- `node scripts/changelog.mjs 0.1.0` prints the body of the 0.1.0 section and
  nothing else, and exits zero.
- `node scripts/changelog.mjs 9.9.9` and a version whose section holds no
  entries both exit non-zero with a message naming the version; requesting
  `Unreleased` is rejected.
- The expected-files array in `tests/integration/packaging.test.ts` includes
  `CHANGELOG.md` and the test passes, and `npm run format:check` covers it.
- `.github/workflows/release.yml` triggers only on `v*` tags, declares
  `contents: write` and `id-token: write`, runs `format:check`, `lint`,
  `type-check`, `build`, and `test` before publishing, fails when the tag does
  not match the `package.json` version, and publishes through trusted publishing
  with no `NPM_TOKEN` secret.
- The workflow fetches `origin/main` explicitly before the ancestry check, and
  a tag whose commit is not reachable from `origin/main` fails the workflow
  before the publish step.
- The repository `vipentti/planlet` is public before the bootstrap publish.
- Rerunning the workflow for a version already on npm skips the publish step
  instead of failing, and creates the GitHub release if it is missing.
- Planlet 0.1.0 is published on npm with the file list recorded by
  `packaging-and-polish`, has a GitHub release, and trusted publishing is
  configured for the repository — all before `release.yml` lands on the default
  branch.
- Pushing tag `v0.1.1` publishes 0.1.1 to npm with a provenance attestation and
  creates a GitHub release whose body equals the 0.1.1 changelog section, with
  no manual step between the tag push and the published release.
- `AGENTS.md` and `README.md` document the release procedure and changelog
  upkeep.

## Verification

Run the full suite in order: `npm run format:check`, `npm run lint`,
`npm run type-check`, `npm run build`, `npm test`, `git diff --check`, and
`git status --porcelain`.

New automated coverage: one test spawning `scripts/changelog.mjs` for a known
version, an absent version, an empty section, and `Unreleased`.

Manual verification:
`node dist/planlet.mjs tools` reporting every destination as `installed`; and
inspection of the `ci.yml` run on the pull request, which already performs the
clean-tree drift check.

The workflow itself cannot be proven by a dry run. Publishing is a
single-attempt, irreversible operation against a public registry, and a
`--dry-run` publish exercises neither OIDC nor `gh release create`. The 0.1.1
release is therefore the verification: record the workflow run conclusion, the
npm provenance status for 0.1.1, and the rendered GitHub release body in a
Verification results section before completing this planlet.

## Risks and Considerations

- Trusted publishing fails in ways that read as ordinary auth errors. A missing
  `id-token: write`, an npm CLI too old, or a misconfigured publisher on
  npmjs.com surfaces as a 401 or 403 at the publish step, after the suite has
  already passed. Confirm the npmjs.com publisher configuration names this
  repository and `release.yml` exactly before tagging.
- The ancestry guard is reachability-only. `main` is unprotected, so anyone
  with write access can push directly to it and tag the result; the guard
  catches stray tags, not unreviewed code. Enabling branch protection is the
  fix if review enforcement is wanted, and is out of scope here.
- `scripts/*.mjs` is outside the ESLint globs; the subprocess test is the check.
- Publishing is irreversible. An unintended version reaching npm cannot be
  withdrawn cleanly, only deprecated. The version guard catches tag and
  `package.json` disagreement, but nothing prevents a human from bumping to the
  wrong version deliberately and tagging it.
- The manual 0.1.0 bootstrap is a human dependency that the workflow does not
  cover, and the workflow is untested until 0.1.1. Treat the first automated
  release as an experiment worth watching rather than a routine push.
- The bootstrap ordering is the sharpest edge here. Landing `release.yml` before
  the manual 0.1.0 publish, or pushing `v0.1.0` afterwards, sends a duplicate
  version at the registry. Making the repository public is irreversible in
  practice: the history becomes visible to everyone, so review it before
  flipping the switch.
- A hand-maintained changelog is only as good as its upkeep. The failure mode is
  a release blocked at notes extraction, which is noisy and recoverable, rather
  than a release with silently wrong notes.

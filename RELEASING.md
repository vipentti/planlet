# Releasing Planlet

Changelog upkeep and the tag-triggered npm / GitHub release flow for
`@vipentti/planlet`. For product usage, see [`README.md`](README.md). Release
gates and workflow contract details also live in
[`plans/completed/2026-08-03-release-automation/plan.md`](plans/completed/2026-08-03-release-automation/plan.md).

## Changelog

Record user-visible changes under `Unreleased` in [`CHANGELOG.md`](CHANGELOG.md).
At release time, move those entries into a dated version section and restore an
empty `Unreleased` section. Ordinary CI runs
`node scripts/assert-changelog-release-ready.mjs`, which requires exactly one
`[Unreleased]` section and at most one structurally valid dated section for the
current `package.json` version. Malformed headings that mention `Unreleased` or
that version still count toward those limits. Explicit release verification uses
`node scripts/assert-changelog-release-ready.mjs --release-date YYYY-MM-DD`.

The same script also validates an already-shipped release and prints its record
date through a historical mode:

```sh
node scripts/assert-changelog-release-ready.mjs --verify-release [--date YYYY-MM-DD] [--print-date]
```

`--verify-release` has no not-in-the-past rule; `--print-date` writes exactly
`YYYY-MM-DD\n` to stdout on success.

From a source checkout, use `node scripts/changelog.mjs <version>` to extract
release notes; that helper is not included in the published npm package.

## Scripted release cut

The repository ships a dependency-free maintainer utility
`scripts/release.mjs` with two subcommands, `prepare` and `tag`. It automates
the happy path and fails safely when it encounters existing or ambiguous state;
it never repairs, resumes, or reconciles interrupted preparation. If `prepare`
leaves partial state, resolve it manually (see [Recovery](#recovery)) and rerun —
there is **no automatic prepare resume**.

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
PR, and creates the PR only after a successful explicit non-force push.

After the PR is reviewed and merged (no auto-merge), proceed to `tag`.

### Tag

```sh
npm run release:tag -- --version X.Y.Z --execute            # create local tag
npm run release:tag -- --version X.Y.Z --execute --push     # push it
```

The tag is annotated and signed (`git tag -a -s`). `tag --release-date D` is the
date the changelog is _expected_ to record (validated historically); without it
the recorded date is derived. `tag` only ever uses the helper's historical
mode. An already-existing remote tag is always refused. An existing valid local
tag can be pushed in a second step with `--push`. After pushing, the remote tag
object is verified.

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

## Tag-triggered releases

After trusted publishing is configured, create an **annotated, signed** tag
`v<version>` that matches `package.json` and is reachable from `main`. Tag
creation for `v*` is limited by a repository ruleset; the release job runs in
the GitHub Environment `release` (required reviewer) and refuses force-moved or
deleted tag pushes. The workflow verifies GitHub reports a signed tag, checks
the tagged source, packs the verified build (`npm pack --ignore-scripts`),
publishes or verifies the exact `@vipentti/planlet` artifact with provenance,
re-checks registry identity/integrity after a new publish, then creates or
updates the GitHub release from the changelog. Do not push a release tag until
the version commit is on `main` and captain gates in the
[release automation plan](plans/completed/2026-08-03-release-automation/plan.md)
are satisfied. After changing the workflow environment name, keep the npm
trusted-publisher environment field in sync (`release`).

The first npm publication (`@vipentti/planlet@0.1.0`) was a manual bootstrap
without `release.yml` on `main`. Later releases use the tag workflow above.

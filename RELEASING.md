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

From a source checkout, use `node scripts/changelog.mjs <version>` to extract
release notes; that helper is not included in the published npm package.

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

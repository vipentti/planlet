# Tasks: Release Automation

- [ ] T1 Add `CHANGELOG.md` in Keep a Changelog 1.1.0 format with an empty `Unreleased` section, a 0.1.0 section backfilled from the completed planlets, and compare links
- [ ] T2 Add `CHANGELOG.md` to the `files` allowlist and the Prettier globs in `package.json`, and to the expected-files array in `tests/integration/packaging.test.ts`
- [ ] T3 Add `scripts/changelog.mjs` printing one version's release notes, exiting non-zero for a missing or empty section and for `Unreleased`
- [ ] T4 Add a test spawning `scripts/changelog.mjs` against a fixture changelog for a known version, an absent version, an empty section, and `Unreleased`
- [ ] T5 Add `.github/workflows/release.yml` triggered by `v*` tags: full suite, tag-versus-version guard, ancestry guard against `origin/main`, notes extraction, trusted-publishing `npm publish`, and `gh release create` — rerun-safe when a version is already on npm
- [ ] T6 Document the release procedure and changelog upkeep in `AGENTS.md` and `README.md`
- [ ] T7 Make the GitHub repository `vipentti/planlet` public, a prerequisite for npm provenance and trusted publishing
- [ ] T8 After T7 and before `release.yml` reaches the default branch, publish 0.1.0 manually, tag `v0.1.0`, create its GitHub release by hand, and configure the npmjs.com trusted publisher naming this repository and `release.yml`; only then land this planlet's changes on `main` and confirm CI is green there
- [ ] T9 On `main`, prepare 0.1.1 — bump `package.json` and the lockfile, promote `Unreleased` to a dated `0.1.1` section with compare links, commit and push so the commit is reachable from `origin/main` — then tag that exact commit, push `v0.1.1`, and record the workflow conclusion, npm provenance status, and rendered release body in the plan's Verification results

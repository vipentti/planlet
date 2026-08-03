# Tasks: Release Automation

- [x] T1 Add `CHANGELOG.md` in Keep a Changelog 1.1.0 format with empty `Unreleased`, a 0.1.0 section reviewed against repository changes and user-visible behavior, and compare links
- [x] T2 Package and format `CHANGELOG.md`, and assert its presence in the packed-artifact integration test
- [x] T3 Add dependency-free `scripts/changelog.mjs` extracting one dated version and rejecting missing, empty, or `Unreleased` sections
- [x] T4 Add focused subprocess coverage against a fixture for known, absent, empty, and `Unreleased` sections
- [ ] T5 Add pinned-action tag workflow with exact release checks, version/main-ancestry guards, trusted provenance publication, changelog notes, verified npm reruns, release create/update behavior, and same-tag concurrency serialization
- [x] T6 Document prepublication source-only install and changelog upkeep in `README.md`, and point release guidance at this planlet
- [x] T7 Review full history, refs intended for exposure, commit metadata, and stored objects for secrets/credentials, licensing or third-party provenance, and personal data; resolve every finding and record captain sign-off before visibility changes
- [ ] T8 Before packing, set the `[0.1.0]` changelog header date to the intended publish day on `main` if it still differs; then from captain-approved clean `origin/main` SHA, reproduce and record exact 0.1.0 package metadata, file list, integrity, shasum, and SHA-256; inspect the tarball; then publish only that approved `.tgz` and verify registry state
- [ ] T9 On `main`, prepare 0.1.1, push its reviewed commit before its exact tag, run the automated release, and record workflow conclusion, npm provenance/integrity, installed package, rendered release body, and safe rerun evidence
- [ ] T10 Immediately before bootstrap, verify npm name availability, authenticated account and 2FA/auth readiness, intended owner identity, package ownership state, and public-access capability; record failure/retry response without claiming the name
- [ ] T11 After T7 and captain public-release authorization, make `vipentti/planlet` public and independently verify anonymous repository and full-history visibility
- [ ] T12 After verified T8 publication and while release workflow is absent from default branch, create `v0.1.0` at exact approved SHA and create matching GitHub release from the dated 0.1.0 changelog notes at that SHA
- [ ] T13 After bootstrap package ownership is verified, configure npm trusted publisher exactly for `vipentti/planlet` and `.github/workflows/release.yml`, then independently verify configuration
- [ ] T14 Land Slice B release automation on `main` only after T12-T13, verify fast-forward source and green main CI, and confirm no release tag was pushed during merge
- [ ] T15 Record captain release-governance choice: accept current strict CI, signed-commit, linear-history, no-force-push/no-deletion, administrator-not-enforced `main` protection, or implement and verify additional tag controls and/or a protected GitHub environment before T13
- [ ] T16 Record captain bootstrap authorization naming npm owner/account, exact clean source SHA, reviewed artifact identity/hash, and permission for irreversible 0.1.0 publication
- [ ] T17 Reconcile Slice B release automation onto current `main`, align Planlet files with exceptional write-once evidence policy, and pass focused, full-suite, generated-skill parity, and packaging checks
- [ ] T18 Document publication gates and common tag-triggered release flow in `README.md`, point `AGENTS.md` to the owner documents without duplicating release procedure, and on planlet completion retarget any README link from `plans/release-automation/` to the completed archive path

## Verification Evidence

- 2026-07-31 — Full-history audit found no unresolved credentials, personal-data, binary or large-object, or licensing/provenance findings; captain approved the audit while the repository remained private.

# Tasks: Manifest Without Tools

- [x] T1 Drop `tools` from the installation manifest with v2-only parse: set `INSTALLATION_MANIFEST_VERSION` to 2, remove `tools` from `InstallationManifest` and `createInstallationManifest` (which then takes only the canonical skill source), make `parseInstallationManifest` accept only `{schemaVersion: 2, files}` and reject unknown `schemaVersion`, malformed `files`, and any manifest carrying a `tools` key, reduce `manifestMatches` to the files comparison, and remove the `HARNESS_ADAPTERS` membership validation (import stays for `detectHarnesses`)
- [x] T2 Update tests: manifest schema test asserts the v2-only round-trip and rejects v1-with-tools, v2-with-tools, unknown `schemaVersion`, and malformed `files`; parsed-manifest `.tools` assertions in unit harness-installer tests are removed or replaced with no-`tools` serialization assertions; installed/modified state tests cover v2 `installed` and classify a legacy v1 manifest as `modified`; harness-installation integration expectations stay green with destination-summary `tools` output unchanged (that output comes from destination resolution, not the manifest)
- [x] T3 Regenerate both tracked `.planlet-manifest.json` files to v2 via `npm run build` plus `node dist/planlet.mjs --root . update --tools all`, confirm files digests unchanged and re-run update is idempotent, add the `CHANGELOG.md` `[Unreleased]` entry for the schema change, confirm no design-doc edit is needed, and pass the full suite (format:check, lint, knip, type-check, build, test, git diff --check, clean porcelain)

## Completion

- Completed at: 2026-08-05T12:48:05.867Z
- Mode: normal

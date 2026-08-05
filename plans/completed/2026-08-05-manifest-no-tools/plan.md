# Manifest Without Tools

## Summary

Drop `tools` from the installation manifest schema. New manifests are schema v2: `{schemaVersion: 2, files}`. The parser accepts only that shape, `manifestMatches` reduces to the files-digest comparison, and both tracked `.planlet-manifest.json` files are regenerated to v2.

## Motivation

The manifest lives inside the destination directory, so the installed tool set is implicit in the location. The `tools` array is redundant: its only consumer is the `manifestMatches` installed/modified check, which the files-digest comparison already decides. Its parse-time `HARNESS_ADAPTERS` membership validation is exactly the adapter-addition downgrade edge — an old CLI reading a manifest written by a newer CLI with an unknown tool id fails with `write_conflict`. Removing the field kills that failure class. It does not fix old-CLI-vs-new-schema compatibility; that remains a loud, expected version-boundary edge.

## Scope

- `src/core/harness-installer.ts`:
  - `INSTALLATION_MANIFEST_VERSION` becomes `2`.
  - `InstallationManifest` loses `tools`; `createInstallationManifest` takes only the canonical skill source and writes `schemaVersion: 2` and `files`.
  - `parseInstallationManifest` accepts only the v2 shape `{schemaVersion: 2, files: string-record}`; no dual-version parse, no v1 normalization, no migration. It rejects unknown `schemaVersion`, malformed `files`, and any manifest carrying a `tools` key.
  - `manifestMatches` becomes `sameRecord(manifest.files, desiredManifest.files)`; all `manifest.tools` references and the `HARNESS_ADAPTERS` membership validation are removed (the import stays for `detectHarnesses`).
- Tests: unit manifest parse/round-trip and invalid-manifest cases, installed/modified state tests, harness-installation integration expectations, and unit harness-installer tests that assert parsed-manifest `tools`.
- Both tracked `.planlet-manifest.json` files regenerated via `planlet update --tools all`.
- `CHANGELOG.md` `[Unreleased]` entry.

## Approach

- Keep `HarnessToolId`, `HARNESS_ADAPTERS`, selectors, and destination summaries untouched — the CLI still needs the tool set to resolve destinations; only the manifest schema changes.
- No migration path: a committed v1 manifest is invalid under the new CLI and fails parse with `write_conflict`; `planlet tools` still reports the destination as `modified` because detection catches parse errors. The repository's own tracked manifests are regenerated to v2 in T3. Acceptable pre-1.0 per captain revision (2026-08-05); deliberately no v1 compatibility code.
- The pending Copilot-adapter decision does not affect ordering: this planlet is standalone and lands first, and the manifest no longer enumerates adapters at all.

## Acceptance Criteria

- Serialized manifests contain `schemaVersion: 2` and `files` only; no `tools` key anywhere.
- Parse round-trips the v2 shape and rejects every other input: unknown `schemaVersion`, malformed or non-string-record `files`, v1 manifests with or without `tools`, and v2 manifests carrying a `tools` key.
- Destination state classification is unchanged: `installed` when current files and manifest files both match desired; `modified` otherwise. Files comparison alone drives it.
- Both `.planlet-manifest.json` files are committed as v2 with unchanged file digests; `planlet update` is then idempotent.
- `CHANGELOG.md` `[Unreleased]` records the schema change.

## Verification

- After T1/T2: `npm run build` and `npm test`.
- After T3: `npm run build`, then `node dist/planlet.mjs --root . update --tools all` regenerates both manifests; diff shows `schemaVersion: 2`, `tools` removed, `files` digests unchanged; run once more to confirm no further diff.
- Full suite: `npm run format:check`, `npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`, `npm test`, `git diff --check`, and `git status --porcelain` clean apart from intended changes (build output is gitignored).
- Strategy only; no `## Verification Evidence` note expected — every check is reproducible in the repository suite, review, and CI.
- If main has moved (frontmatter PR #40 merged) before implementation, rebase the branch first; plan content is unaffected.

## Risks and Considerations

- Committed v1 manifests become invalid under the new CLI: parse fails loudly with `write_conflict` and there is no automatic rewrite. Deliberate pre-1.0 simplification, not a bug.
- Old CLI cannot parse a v2 manifest and fails loudly with `write_conflict`. Expected version-boundary edge; deliberately not fixed here.
- `planlet_design.md` does not document the installation manifest schema, so no design-doc edit is required (verified by search).

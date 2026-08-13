# Migrate planlet release to npm-release-flow kit

## Summary

Adopt `vipentti/npm-release-flow@0.1.0` as the sole release owner. Ship the first kit release `0.5.1` and delete the bespoke release path so only the thin caller remains. Outcome is a single releaser with no dual paths.

## Scope

In scope — files and boundaries touched:

- `package.json` / `package-lock.json`.
- `scripts/` release helpers (`scripts/release.mjs`, `detect-release-merge.mjs`, `verify-release-tag.mjs`, `scripts/verify-release-tag.d.mts` and related tests/docs) and `knip.json` entry for `scripts/verify-release-tag.d.mts` plus npm scripts `release:prepare` / `release:tag` removed after the cut; `scripts/assert-changelog-release-ready.mjs` is PRESERVED for its ordinary no-flag CI lint duty (cardinality, valid dates, non-empty notes, link refs) and shrunk to that mode only if release-specific modes go unused.
- `.github/workflows/release.yml` and `.github/workflows/ci.yml`, plus workflow-coupled tests `tests/integration/release-workflow.test.ts`, `release-intent.test.ts`, `package-artifact.test.ts`, `validate-packed-artifact.test.ts` that mirror `release.yml` steps.
- `RELEASING.md`, `AGENTS.md`, `README.md`.
- Repository-level GitHub Actions configuration (owner/manual provisioning) and the `release` environment gate; removal of old `RELEASE_*` environment secrets and variables after the successful `0.5.1` cut. Each `NPM_RELEASE_FLOW_*` value is sourced outside GitHub because secrets are write-only: `NPM_RELEASE_FLOW_GPG_PRIVATE_KEY` from `gpg --export-secret-keys --armor <fingerprint>`, `NPM_RELEASE_FLOW_GPG_PUBLIC_KEY` from `gpg --export --armor <fingerprint>`, `NPM_RELEASE_FLOW_GPG_PASSPHRASE` from the passphrase store, `NPM_RELEASE_FLOW_APP_PRIVATE_KEY` from the Release Automation App private-key PEM; variables `NPM_RELEASE_FLOW_GPG_FINGERPRINT`, `NPM_RELEASE_FLOW_APP_ID`, `NPM_RELEASE_FLOW_GIT_NAME`, `NPM_RELEASE_FLOW_GIT_EMAIL` from the same key/App identity. Local `npx npm-release-flow check` also requires `NPM_RELEASE_FLOW_APP_PRIVATE_KEY` and `NPM_RELEASE_FLOW_GPG_FINGERPRINT` (fingerprint matching the repository variable and the local secret key) exported in the operator env, plus signing preflights (`gpg --list-secret-keys <fingerprint>` and `git config user.signingkey`).

Out of scope: dedicated GPG keypair, Release App, and `main` / `v*` branch protection beyond the gate above.

## Approach

Inventory at clean `0c17616` showed only gitignored `node_modules/`/`dist` plus report and Lavish artifact; this branch was cut from `origin/main` and scope stays at `plans/npm-release-flow-migration/{plan,tasks}.md`.

Fixed decisions — single owning section (all 8, not negotiable; results verified in Acceptance Criteria, not restated elsewhere):

1. adopt adapted — kit caller + `release:verify` + exact pin as sole owner.
2. secret naming coexist-then-delete — add `NPM_RELEASE_FLOW_*` at repository level alongside any existing `RELEASE_*` for one cycle; old removed only after first kit release succeeds.
3. keep `release.yml` filename — do not rename to `self-release.yml`; re-confirm Trusted Publishing matches `release.yml`.
4. `release:verify` is `npm run lint && npm run format:check && npm run type-check && npm run knip && npm test && npm run skills:update && git diff --exit-code` (reuses the existing CI drift pattern `npm run skills:update && git diff --exit-code`); never rely on kit's post-dist build.
5. deprecate `--release-date` — cut date always today UTC via kit `todayUtc()`.
6. `queue: max` alongside `cancel-in-progress: false`.
7. pin advances only when upgrading the kit version, atomically with exact `devDependency` in one ordinary PR; no advance after consumer `0.5.1`.
8. keep GPG key — reuse dedicated keypair, no rotation coupled to migration.

Code judo: `npm-release-flow` is the sole release owner. The exact caller contract (`permissions`, `concurrency`, `secrets` pin) is encoded once in the thin workflow; bespoke detection, validation, tagging and `release.mjs` entry points are deleted after the cut.

Caller contract — single encoding in `.github/workflows/release.yml`: top-level `permissions: {}` with job `release` `permissions: contents: write, pull-requests: read, id-token: write`, `concurrency: {group: release-main, cancel-in-progress: false, queue: max}`, explicit `secrets: NPM_RELEASE_FLOW_*`, pin is a full 40-char SHA for `0.1.0` (currently `2ddb84caa71d25946a8c718d9364ef6db2699704`). Repository-level secrets are required by the kit's `check`; publish still gates on `environment: release` approval and each secret loads only on its path. Workflow verification is `npm run format:check` (covers `.github/workflows/*.yml`); no separate `actionlint` installation is required.

Ordered steps — task sequencing only (`is-release:false` except T5 publish):

- T1: kit pin and `release:verify` via `skills:update`.
- T2: owner/manual provisioning of repository-level `NPM_RELEASE_FLOW_*` from the local GPG/App sources above (each secret value from its local source because GitHub never reads secret values back), plus `release` gate and `v*` rulesets confirmed; local `check` also needs `NPM_RELEASE_FLOW_APP_PRIVATE_KEY` and `NPM_RELEASE_FLOW_GPG_FINGERPRINT` (matching variable + local key) in env and signing preflights.
- T3: Trusted Publishing for `release.yml`.
- T4: thin reusable caller replaces bespoke workflow and deletes/replaces workflow-coupled tests `tests/integration/release-workflow.test.ts`, `release-intent.test.ts`, `package-artifact.test.ts`, `validate-packed-artifact.test.ts` that extract steps/assertions from `release.yml`, plus the `ci.yml` shellcheck install step `install shellcheck for workflow script lint` and `shellcheck` from `knip.json` `ignoreBinaries` (existed only for `release-workflow.test.ts`); `npm test` stays green because the thin caller has no workflow steps to extract — keep tests for retained `assert-changelog-release-ready.mjs` until T7.
- T5: first kit release `0.5.1` via `npx npm-release-flow prepare --version 0.5.1 --execute` (dry-run is `npx npm-release-flow prepare --version 0.5.1`). Post-prepare: update the generated release PR body to `.github/pull_request_template.md` while preserving the exact `Kit: @vipentti/npm-release-flow@0.1.0` line required for kit detection. Repository-approved exception: the exact-three-file release PR (`CHANGELOG.md`, `package.json`, `package-lock.json`) MUST NOT carry `plans/*` task-state changes even when the PR would otherwise finish a planlet task per `AGENTS.md`; T5's `task check` is recorded in the immediate post-release ordinary push (or a follow-up branch) so the release allowlist stays exact and `AGENTS.md` bookkeeping is satisfied without conflict.
- T7: migration cleanup after successful `0.5.1` (release-ownership deletion only; ordinary changelog lint stays).

T7 live-contract decisions: delete `scripts/release.mjs` and `release:prepare`/`release:tag` plus `detect-release-merge.mjs`, `verify-release-tag.mjs`, `scripts/verify-release-tag.d.mts` and the `knip.json` `ignore` entry for that declaration file plus related tests/docs — PRESERVE `scripts/assert-changelog-release-ready.mjs` for ordinary no-flag CI lint (and shrink it to cardinality/valid-dates/non-empty-notes/link-refs only if release-specific modes are unused); keep the `ci.yml` step `node scripts/assert-changelog-release-ready.mjs` (or its shrunk name if renamed, stated explicitly if kept); update `AGENTS.md` release guidance and the `Rejected simplifications` `--release-date` entry to match the kit flow while keeping the ordinary-lint helper; delete old `RELEASE_*` environment secrets and variables; verify zero live references to deleted release helpers and the declaration path remain — sweep excludes `plans/` (the active planlet still mentions deleted helpers and legacy names) and uses anchored patterns like `\bRELEASE_GPG_`, `\bRELEASE_APP_`, `\bRELEASE_GIT_` and `scripts/verify-release-tag\.d\.mts` that do not match `NPM_RELEASE_FLOW_`.

Not a task: kit version upgrades bump caller pin with the exact `devDependency` in one ordinary PR; documented here and in `RELEASING.md`. Ordering: T1 before T4; T2 before T5; T7 waits on T5; old values persist until T7 so reruns stay green.

## Acceptance Criteria

- Thin caller is the only releaser; `scripts/release.mjs`, `release:prepare`/`release:tag`, `scripts/verify-release-tag.d.mts` and helpers are absent.
- Ordinary pushes are green; only the three-file allowlist is a release and the handoff tarball is intact.
- Kit release `0.5.1` is signed, provenance-published and has a GitHub Release.
- `release:verify` fails on dirty generated skills or `git diff --exit-code` findings; kit `check` is clean.
- `queue: max` present and Trusted Publishing still bound to `release.yml`.
- After T7, live code and docs outside `plans/` contain no anchored references to deleted release helpers (`\bRELEASE_GPG_`, `\bRELEASE_APP_`, `\bRELEASE_GIT_`, `scripts/(release|detect-release-merge|verify-release-tag)\.mjs` and `scripts/verify-release-tag\.d\.mts` plus its `knip.json` ignore entry, not matching `NPM_RELEASE_FLOW_`); `ci.yml` still invokes the preserved ordinary changelog lint helper and no longer contains the shellcheck install step `install shellcheck for workflow script lint`, and `AGENTS.md` matches the kit flow — the `Rejected simplifications` `--release-date` entry is updated to keep the ordinary no-flag lint rationale, not removed entirely.
- After T7, `RELEASE_*` environment secrets and variables are absent, verified via repository settings listing.

## Verification

- Local: `npm ci`, `npm run release:verify`, `npx npm-release-flow check`, `npm run format:check`.
- CI: matrix green on thin caller as an ordinary push.
- Release: `detect is-release:true`, `verify` handoff and pack-contract, `release` revalidation, provenance publish and GitHub Release.
- Edge: ordinary on version decrease, prerequisite rejection on missing `Unreleased`.
- Sweep: `grep -rE` outside `plans/` for anchored `\bRELEASE_GPG_|\bRELEASE_APP_|\bRELEASE_GIT_`, `scripts/verify-release-tag\.d\.mts` and deleted `scripts/` helpers (excluding `assert-changelog-release-ready.mjs`) finds nothing; that helper plus `NPM_RELEASE_FLOW_*` remain intentionally, and `knip.json` no longer ignores the deleted declaration file or `shellcheck`.

## Risks and Considerations

- Thin caller is the highest-risk file; keep diff small, pin verified, keep coexistence secrets until T7.
- First release spans branch/PR/merge/detect/verify/approval/tag/publish; tag is the last irreversible mutation. `prepare` never auto-resumes; reruns reuse the caller's workflow file, so a stale pin blocks fix until revert and recut.

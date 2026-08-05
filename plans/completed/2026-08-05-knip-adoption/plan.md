# Knip Adoption

## Summary

Adopt knip as an exact-pinned devDependency and gate it in CI so unused exports
and unlisted binaries fail locally and in pull requests. The current tree has
13 unused exports (internal over-exports, each used only inside its declaring
module) and one unlisted binary (`ssh-keygen`, spawned by the release-utility
integration test). Remove the `export` keyword from the 13 verified symbols,
allowlist `ssh-keygen` in `knip.json`, add an `npm run knip` script, and wire
knip into CI. No product or CLI behavior change; no published-surface change
(`files` ships only `dist/` and `skills/`; `src/` is never published).

## Scope

- `package.json`: add `"knip": "6.31.0"` under `devDependencies` (exact pin,
  matching repo versioning) and `"knip": "knip"` under `scripts`.
- New `knip.json`: `$schema` plus `ignoreBinaries: ["ssh-keygen"]` only. Entry
  points and exports stay on knip defaults; no `entry`, `exports`, or
  `project` overrides.
- `src/**/*.ts`: remove the `export` keyword from the 13 symbols in Approach;
  all internal references and behavior stay unchanged.
- `.github/workflows/ci.yml`: add `- run: npm run knip` to the verify matrix,
  directly after `npm run lint`.
- Add `knip.json` to the `npm run format` and `npm run format:check` file lists
  so the config is formatting-gated like `tsconfig.json` and
  `eslint.config.js`.
- `package-lock.json` gains knip via `npm install` in T1.

Out of scope: transitive dead clusters and unused object/interface properties
(no analyzed tool catches them; residual gap documented in scout report §4);
eslint or tsc config changes; `noUnusedLocals`/`noUnusedParameters` (already
landed); dist output; CLI, skills, README, design doc, and CHANGELOG
(maintainer tooling only — no changelog entry; state that in the PR).

## Approach

Fresh findings (2026-08-05, current main, knip 6.31.0):

- Unlisted binaries (1): `ssh-keygen` — spawned at
  `tests/integration/release-utility.test.ts:120,123,137`.
- Unused exports (13), each verified via `rg` to have zero cross-file imports
  and to be used only inside its declaring module:

| Symbol | Kind | Declaring file:line (fresh run) |
| --- | --- | --- |
| `validateCreationTitle` | function | `src/core/creation.ts:54` |
| `INSTALLATION_MANIFEST_VERSION` | const | `src/core/harness-installer.ts:31` |
| `ValidationEntry` | interface | `src/commands/read-only.ts:70` |
| `CreatePlanletDependencies` | interface | `src/core/creation.ts:26` |
| `HarnessState` | type | `src/core/harness-installer.ts:39` |
| `HarnessInstallationSummary` | interface | `src/core/harness-installer.ts:41` |
| `InstallationSummary` | interface | `src/core/harness-installer.ts:49` |
| `InstallTxStep` | type | `src/core/harness-installer.ts:372` |
| `HarnessAdapter` | type | `src/core/harnesses.ts:22` |
| `CompletePlanletDependencies` | interface | `src/core/planlet-completion.ts:36` |
| `CanonicalSkillFile` | interface | `src/core/skill-source.ts:15` |
| `TaskUpdateOperation` | type | `src/core/task-update.ts:17` |
| `UpdateTaskDependencies` | interface | `src/core/task-update.ts:28` |

De-export rule: before removing any `export` keyword, re-run knip fresh on the
current branch, confirm the finding, then `rg -n "<symbol>" src tests scripts`
to prove only declaring-module references. If a flagged symbol is actually
consumed elsewhere (test, DI seam, public surface), keep the export and add
`/** @public */` above it — knip's documented allowlist tag — instead of
removing it.

Config mechanics: `ignoreBinaries` is the documented knip option for binaries
knip cannot resolve from package manifests; `/** @public */` is the documented
per-export allowlist tag.

CI placement: `npm run knip` in the verify matrix after `npm run lint`; exact
pin plus lockfile makes the check deterministic, and knip is
platform-independent, so no OS-conditional step is needed.

## Acceptance Criteria

- `npm run knip` exits 0 with zero findings on the clean tree.
- The 13 symbols no longer carry `export`; each is referenced only in its
  declaring module (`rg` proof); no import of any of the 13 exists in `src/`,
  `tests/`, or `scripts/`.
- `knip.json` contains only the schema and `ignoreBinaries: ["ssh-keygen"]`;
  `ssh-keygen` no longer appears as an unlisted binary.
- Full suite green: `npm run format:check`, `npm run lint`, `npm run
  type-check`, `npm run build`, `npm test`, `git diff --check`; `git status
  --porcelain` empty (dist gitignored).
- CI workflow includes the knip step and the PR run shows it green.
- Diff limited to: `package.json`, `package-lock.json`, `knip.json`,
  `.github/workflows/ci.yml`, and `src/**/*.ts` export-keyword removals. No
  behavior, CLI, or skill change.

## Verification

Strategy only — results live in the suite, review, and CI, not in these files.

- Per-task: `npm run knip` after T2 (no unlisted binaries; 13 exports remain)
  and after T3 (exit 0, zero findings).
- Per-symbol: `rg -n "<symbol>" src tests scripts` before de-export; only
  declaring-module lines may match.
- Full gate: `npm run format:check && npm run lint && npm run type-check && npm
  run build && npm test`, then `git diff --check` and `git status --porcelain`
  (expect empty).
- CI: verify matrix runs `npm run knip`; PR check green.
- No `## Verification Evidence` section expected: every outcome is
  reproducible through ordinary git, suite, review, and CI history.

## Rejected Alternatives

- ts-prune 0.10.3 — flags 38 exports including API types used in exported
  signatures (false positives knip avoids); exits 0 without `--error`, and
  `--error` fails on all 38 today. Rejected (scout report §3D).
- eslint-plugin-import `no-unused-modules` — peer-incompatible with eslint 10
  (ERESOLVE), requires a legacy `.eslintrc` under flat config, and needs a TS
  resolver; probe produced 123 unresolved-import and 136 no-unused-modules
  errors including false positives on used exports. Rejected (§3E).
- eslint-plugin-unused-imports — overlaps the already-active
  `@typescript-eslint/no-unused-vars`; only adds autofix. Rejected (§3F).
- eslint-plugin-unicorn — no dead-export/import coverage; `no-unused-properties`
  targets enum-like object-literal properties only. Rejected (§3G).
- Type-aware eslint (`recommendedTypeChecked`) — no dead-export coverage;
  slower lint for no dead-code gain. Rejected (§3H).
- tsc `noUnusedLocals`/`noUnusedParameters` — already landed (#30);
  complementary (module locals, private members), not an alternative for
  exports.

## Risks and Considerations

- Future knip upgrades may surface new findings; CI gates them and they get
  fixed in separate changes; exact pin plus lockfile keeps this change
  deterministic.
- De-exporting types referenced by exported signatures (`CreatePlanletDependencies`,
  `CompletePlanletDependencies`, `HarnessAdapter`, and similar) is safe: the
  build is `noEmit` plus an esbuild bundle, no declaration emit exists, and
  knip counts type usage correctly.
- If a later change needs a de-exported symbol, restore the `export` keyword
  normally.

# Modularize source layout

## Summary

Restructure `src/` into responsibility-clustered folders, driven by the scout
report `data/planlet-modularize-scout-q1/report.md` (baseline `HEAD = 9512c1e`,
verified in this worktree). Move the 6-file harness cluster into
`src/core/harness/`, the 11-file plan cluster into `src/core/plan/`, and split
`src/commands/handlers.ts` into `src/commands/shared.ts` plus one file per
command. Pure file moves, import-path rewrites, and one mechanical handler
split: no behavior, export, or logic change.

## Scope

- **T1** — Move the harness cluster to `src/core/harness/`: `harnesses.ts`,
  `skill-source.ts`, `agent-snippet.ts`, `harness-manifest.ts`,
  `harness-publish.ts`, `harness-installer.ts` (report §4.2, §4.3).
- **T2** — Split `src/commands/handlers.ts` into `commands/shared.ts`
  (`ExecutionContext`, `emit`, `EmitOutcome`, `compactSummary`,
  `warningsFromSummaries`) and one file per command (report §5.3): `onboard.ts`,
  `init.ts`, `update.ts`, `tools.ts`, `list.ts`, `create.ts`, `show.ts`,
  `status.ts`, `tasks.ts`, `validate.ts`, `task-update.ts`, `complete.ts`,
  `dashboard.ts`. Command-argument interfaces co-locate with their handler
  (`HarnessCommandArguments`, `ListCommandArguments`, `CreateCommandArguments`,
  `ShowCommandArguments`, `TasksCommandArguments`, `ValidateCommandArguments`,
  `TaskUpdateCommandArguments`, `CompleteCommandArguments`).
- **T3** — Move the plan cluster to `src/core/plan/`: `models.ts`, `slugs.ts`,
  `task-parser.ts`, `completion.ts`, `status.ts`, `planlet-files.ts`,
  `validation.ts`, `read-only.ts`, `creation.ts`, `task-update.ts`,
  `planlet-completion.ts` (report §4.2).

Out of scope (report §4.2, §9): splitting `read-only.ts` or
`planlet-completion.ts`; any change to `paths.ts` or `planlet-lock.ts` internals;
sub-subfolders inside `core/plan/`; co-locating `cli.ts` argument parsing and
help text per command (flagged separate behavioral follow-up); and splitting
`task-update.ts` into separate check/uncheck files — the CLI has one `task`
command with an `operation` argument, so one handler file stays.

## Approach

Ground everything in the scout report; its import map (§7) and DAG tiering (§3)
are current and cycle-free. Module paths are not a published contract — the CLI
is a single esbuild bundle (`scripts/build.mjs`), so moves are internal-only
churn.

- **T1** — Move the 6 files as one group. Intra-cluster imports
  (`./harness-manifest.js`, `./harnesses.js`, etc.) are unaffected by a
  same-group move. Rewrite only the floor/error imports: `./paths.js` →
  `../paths.js`, `./planlet-lock.js` → `../planlet-lock.js`,
  `../errors/*` → `../../errors/*`. Keep the deliberate back-compat re-exports
  in `harness-installer.ts` (`INSTALLATION_MANIFEST` plus the manifest helpers
  re-exported from `harness-manifest.js`) intact. External importers to
  update: `cli.ts` (2 import statements), `commands/handlers.ts` (2), and 6
  test files. Full suite after.
- **T2** — Extract `shared.ts` from the current `handlers.ts` (the five shared
  members), then create one file per command, each exporting its handler (and
  its command-argument interface) and importing only what it needs.
  `handleDashboard` gets its own `dashboard.ts`. Keep ONE `task-update.ts` with
  `handleTaskUpdate`. Update `cli.ts` imports (currently
  `./commands/handlers.js`) to direct per-file imports, and the two test files
  that import handlers directly: `tests/integration/cli-in-process.test.ts`
  (`handleList`) and `tests/integration/safety.test.ts`
  (`handleCreate`/`handleShow`/`handleTasks`/`handleValidate`). No
  `commands/index.ts` barrel — direct imports are clearer at 13 commands.
  Delete `handlers.ts` after the split. Full suite after.
- **T3** — Move the 11 plan files as one group. Intra-cluster imports
  (`./models.js`, `./slugs.js`, etc.) are unaffected by a same-group move.
  Rewrite floor/error imports: `./paths.js` → `../paths.js`,
  `./planlet-lock.js` → `../planlet-lock.js`, `../errors/*` →
  `../../errors/*`. External importers to update: `cli.ts` (`./core/models.js` →
  `./core/plan/models.js`), the per-command files created in T2 (`create`,
  `show`, `status`, `tasks`, `validate`, `task-update`, `complete`, plus any
  shared/onboard/tools references), and the ~12 test files that import plan
  cluster members directly. `repository.ts` stays flat in `src/core/`. Full
  suite after.

Task order is T1 → T2 → T3: each is independently verifiable, and T3's
external-importer list depends on the per-command files existing (created in
T2).

## Acceptance Criteria

- `src/core/` matches the report §4.2 target tree: flat `paths.ts`,
  `planlet-lock.ts`, `repository.ts` plus `plan/` (11 files) and `harness/`
  (6 files).
- `src/commands/` matches the report §5.3 target tree: `shared.ts` plus 13
  per-command files; no `handlers.ts`, no `index.ts` barrel.
- No behavior change: same CLI surface, same exports and types, same test
  outcomes. Back-compat re-exports in `harness-installer.ts` survive unchanged.
- All existing tests pass (`npm test`, 330 tests) and the full repository
  verification suite is green.
- No `task-check.ts` / `task-uncheck.ts` split, no sub-subfolders inside
  `core/plan/`, no changes to `paths.ts` / `planlet-lock.ts` internals.

## Verification

Strategy, run after each of T1, T2, T3 and again before PR:

- `npm run format:check` — no formatting drift, including `cli.ts` and the
  rewritten imports.
- `npm run lint` and `npm run knip` — no dead imports left behind by the moves
  or split; knip must still resolve entry points after file moves.
- `npm run type-check` — every rewritten import resolves; this is the primary
  mechanical guard for the ~10 (harness) and ~24 (plan + commands) import
  rewrites.
- `npm run build` — the single-bundle build succeeds from the new layout.
- `npm test` — full suite (330 tests) passes with only import-path test edits.
- `git diff --check` — no whitespace errors.
- After T1/T2/T3 each: confirm `git status --porcelain` shows only the intended
  moves and rewrites, and `git diff` for moved files contains only import
  rewrites, no logic or export changes.

No `## Verification Evidence` note is planned: all verification is reproducible
via ordinary suite runs held by CI and review.

## Risks and Considerations

- **knip** — file moves can orphan or disconnect paths if a move is partial;
  mitigated by moving each cluster as one group and running the full suite per
  task.
- **Test import churn** — every core file except `harness-publish.ts` and
  `planlet-files.ts` is imported directly by a unit test. The report numbers
  the affected test files (6 harness, ~10 plan, 2 handlers); treat the listed
  counts as lower bounds and let `type-check` + `test` catch the rest.
- **No circular-import risk** — the graph is an acyclic bottom-up DAG and both
  moves preserve downward edges (report §3); do not restructure imports during
  the pass.

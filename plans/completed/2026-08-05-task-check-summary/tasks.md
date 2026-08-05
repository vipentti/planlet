# Tasks: Task Check Summary Output

- [x] T1 Extend `UpdateTaskResult` with `state`, `done`, `total`, and conditional `next` on both return paths in `src/core/task-update.ts`, binding the currently discarded post-write validation result and deriving the summary via `deriveLifecycleState`
- [x] T2 Add integration coverage for non-final check, final check with `next`, uncheck regression, and idempotent `changed: false`, plus a compiled-CLI output-shape assertion for the new fields
- [x] T3 Document the additive output: `planlet_design.md` §13.4 output-rules line, `CHANGELOG.md` `[Unreleased]` `Added` entry, and confirm no `AGENTS.md` command-table row is needed
- [x] T4 Add the `ready_to_complete` handoff sentence to `skills/planlet-implement/SKILL.md` step 6, update the skill-contract scenario fixture and expected-ID list, regenerate and commit tracked skill copies via `planlet update --tools all`, and verify skill tests

## Completion

- Completed at: 2026-08-05T09:15:46.749Z
- Mode: normal

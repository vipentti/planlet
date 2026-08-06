# Tasks: Promote Code Judo Major Refactors

- [x] T1 Move read-side domain operations into `src/core/read-only.ts`, rewire handlers and direct test imports, and verify list/show/status/tasks/validate behavior remains unchanged
- [x] T2 Make `emit` return typed `{ exitCode, data, warnings }` and make `handleValidate` derive `invalidPlan` from returned data without closure state; verify success, invalid-plan, and error exit/output behavior
- [x] T3 Extract installation-manifest constants, types, creation, parsing, and serialization into a dedicated core module while preserving current exports and manifest compatibility; verify manifest and installer tests
- [x] T4 Extract `publishDestinationTransaction` plus `transactionHooks` into a dedicated core module while preserving staging, backup, rollback, cleanup-warning, and recovery-directory protocols; verify harness transaction tests
- [x] T5 Run full required verification, inspect scope for absence of Suggestions 4–9, check all tasks with Planlet CLI, and prepare committed direct-PR handoff

## Completion

- Completed at: 2026-08-06T16:54:01.757Z
- Mode: normal

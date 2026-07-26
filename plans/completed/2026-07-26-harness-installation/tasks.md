# Tasks: Harness Installation

- [x] T1 Add harness registry with normalized selectors, invalid-combination handling, stable destination aliases, and duplicate-target coalescing
- [x] T2 Resolve canonical skill source and enumerate skill files for development and bundled execution
- [x] T3 Implement installer core with versioned manifests, full-operation preflight, safe reconciliation, atomic publication, and compact summaries
- [x] T4 Add the `unsupported_tool` error code and its exit-code mapping
- [x] T5 Implement `init` including `plans/` initialization and `--tools none`
- [x] T6 Implement `update` with existing-installation-only refresh, legacy adoption, stale generated-file removal, idempotency, and `--force`
- [x] T7 Implement `tools` with non-mutating missing, unmanaged, installed, and modified detection
- [x] T8 Wire `init`, `update`, and `tools` into CLI parsing and the help surface
- [x] T9 Add unit tests for selector normalization, registry coalescing, manifest schema and hashing, reconciliation, and path safety
- [x] T10 Add integration tests for commands, legacy adoption, stale files, cross-destination conflicts, forced recovery, idempotency, and compiled-bundle source resolution
- [x] T11 Dogfood legacy adoption and repeat-update idempotency, remove `sync-skills.ps1`, and update npm scripts and documentation
- [x] T12 Run the full verification suite and inspect intended diffs plus pre-run versus post-run Git status

## Completion

- Completed at: 2026-07-26T05:18:20.544Z
- Mode: normal

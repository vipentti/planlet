# Promote Code Judo Major Refactors

## Summary

Resolve three Major structural findings from the 2026-08-06 code-judo review while preserving Planlet behavior: move read-side domain operations into `src/core/`, make handler emission return its structured outcome, and split manifest and publish-transaction concerns from `harness-installer.ts`.

## Scope

- Relocate read-side discovery, loading, status, task, show, list, and validation logic from `src/commands/read-only.ts` to `src/core/read-only.ts`; keep command handlers as adapters and update direct imports.
- Change `emit` in `src/commands/handlers.ts` to return exit code, operation data, and warnings. Make `handleValidate` derive `invalidPlan` from returned validation data instead of a closure side channel.
- Extract installation-manifest creation, parsing, and serialization into one core module.
- Extract `publishDestinationTransaction` and its staging, backup, rollback, cleanup, warning, and `transactionHooks` protocol into one core module.
- Preserve command output, exit codes, manifest compatibility, transaction failure behavior, recovery-directory names, hook steps, and lock orchestration.

Do not implement code-judo Suggestions 4–9. Do not change product behavior, add dependencies, alter lock behavior, or update changelog for this internal behavior-preserving refactor.

## Approach

1. Move read-side code mechanically, changing only relative imports and callers. Keep domain types and validation flow unchanged; update tests that import the old module path.
2. Introduce a typed generic emission result. Successful operations retain rendered output side effects and expose their original `data` and `warnings`; Planlet errors retain current diagnostics and exit mapping with no operation data. `handleValidate` maps a successful `valid: false` result to `invalidPlan` from that returned data.
3. Create focused manifest and transaction modules. Keep destination inspection, install orchestration, detection, and lock boundaries in `harness-installer.ts`. Re-export moved manifest constants/helpers or types when needed to avoid incidental API changes. Keep `transactionHooks` and recovery-directory protocol unchanged.
4. Run focused and full verification, then check every implementation task through the Planlet CLI before the direct PR handoff.

## Acceptance Criteria

- Read-side domain logic has one source under `src/core/`; `src/commands/handlers.ts` remains a thin command adapter and no read behavior changes.
- `emit` exposes `{ exitCode, data, warnings }` to callers; `handleValidate` has no mutable `valid` closure and preserves valid, invalid, and error exit behavior.
- Manifest schema/version handling and deterministic serialization remain byte- and error-compatible.
- Harness publish staging, backup, rollback, cleanup warnings, fault-injection hooks, and `.planlet-bak-*`/`.planlet-tx-*` recovery behavior remain unchanged while living outside the orchestration module.
- Existing test suite passes with no changes outside these three refactors, and Suggestions 4–9 remain untouched.
- Full required checks pass: `npm test`, `npm run type-check`, `npm run lint`, `npm run knip`, `npm run format:check`, and `git diff --check`.
- Before PR, all planlet tasks are verified with `planlet task check`; branch is committed, pushed, and PR is opened with `gh-axi`, mapping each Major finding to its change.

## Verification

- Use existing read-only, safety, in-process CLI, manifest, harness-installation, and compiled CLI tests to prove unchanged behavior and exit/output contracts.
- Run `npm test` (330-test baseline), `npm run type-check`, `npm run lint`, `npm run knip`, `npm run format:check`, and `git diff --check` after implementation.
- Inspect imports and module boundaries to confirm domain logic moved to `src/core/`, handlers do not retain read implementation, and `harness-installer.ts` retains only orchestration, destination inspection, and detection.
- Validate this planlet with `planlet --root . validate code-judo-major-refactor`; after implementation, check each task with `planlet task check` and complete the planlet before opening the PR when all tasks are checked.

## Risks and Considerations

- Moving files changes relative imports and direct test imports; type-check and read-only integration tests catch missed edges.
- `emit` must preserve rendering side effects and error exit mapping while adding returned data; validate and compiled CLI tests cover this boundary.
- Transaction extraction has high failure-path risk. Keep existing `transactionHooks`, rollback ordering, cleanup-warning behavior, and recovery-directory protocol intact; harness unit and integration tests are the safety net.

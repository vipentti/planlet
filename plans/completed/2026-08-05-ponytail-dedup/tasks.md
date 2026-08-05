# Tasks: Ponytail Dedup

- [x] T1 Consolidate the three atomic write/rename/rollback dances into one shared `atomicPublish` helper
      Acceptance:
      - `atomicPublish(options)` exported from `src/core/paths.ts`; options
        carry `temporaryPath`, `targetPath`, `createTemporary`, `prepare`,
        `rename`, `remove`, `onFailure(error)`, and `cleanupFailure { code,
        message, details, aggregateMessage?, fatal }`.
      - `creation.ts` passes `mkdirSync` as `createTemporary` and a `prepare`
        that writes both stub files and rechecks collisions before rename;
        `task-update.ts` and `planlet-completion.ts` pass mode-preserving
        temp-file writes as `createTemporary` with their own rename seam.
      - Each call site keeps its existing error code (`write_conflict`),
        message, details bag, aggregate message, and passes `fatal: true`.
      - Rollback removes only the helper's own temp path; a pre-existing
        temp-path collision (write failure before creation) is left untouched.
      - Double-fault preserves both causes in `AggregateError`; creation's
        cleanup-failure error keeps `{ slug, temporaryPath, cleanupFailed:
        true }` details and the mapped primary as first cause.
      - Existing fault-injection tests pass unchanged (creation partial write,
        creation cleanup failure, task-update rename failure, task-update temp
        collision); full suite green.
- [x] T2 Replace the four local `asWriteConflict` copies with one exported helper
      Acceptance:
      - `asWriteConflict(error, message, details)` exported from
        `src/errors/planlet-error.ts`; returns the error unchanged when already
        a `PlanletError`, else builds `write_conflict` with the given
        message/details and `cause`.
      - Call sites in creation, task-update, planlet-completion, and
        harness-installer pass their existing message and details; rendered
        errors unchanged.
      - No local `asWriteConflict` definitions remain; full suite green.
- [x] T3 Add one exported `errnoIs(error, ...codes)` in paths.ts and replace the six inline predicates
      Acceptance:
      - `errnoIs` exported from `src/core/paths.ts`; true only for `Error`
        instances with a string `code` in the supplied list.
      - Replaces the predicates in paths (`isMissingPathError` and the
        `tryLstat` ENOTDIR check), planlet-lock (`isAlreadyExists`,
        `isNotFound`), skill-source, and cli (`hasEntries`); no inline
        `"code" in error` checks remain at those sites.
      - Error handling behavior unchanged; full suite green.
- [x] T4 Add one exported `byName` comparator and replace the five sort sites
      Acceptance:
      - `byName(left, right)` exported from `src/core/paths.ts` using the same
        codepoint comparison as today.
      - Replaces the comparators in read-only `directoryEntries`, skill-source,
        and the three harness-installer sites (record pairs and Dirent lists).
      - Sorted output byte-identical (locale-independent codepoint order);
        full suite green.
- [x] T5 Delete the unreachable read-only guards and production-entry branch; drop pid from lock interfaces and validation
      Acceptance:
      - The three `TypeError` guards in `read-only.ts` are gone; cli usage
        validation still rejects the same inputs.
      - The `isPlanletError` branch in `renderUnexpectedError` is gone; cli.ts
        still renders `PlanletError` at its own boundary.
      - Direct-call tests updated only where they pinned removed internals:
        the two `TypeError` assertions in `read-only.test.ts` removed; the two
        `renderUnexpectedError(PlanletError)` call sites
        (`compiled-cli.test.ts`, `planlet-lock.test.ts`) re-pointed at
        `renderToonError(error.toStructuredError())` with the same
        assertions; `pid` removed from the six planted lock holders in
        `planlet-lock.test.ts`.
      - `planlet-lock.ts`: `pid` removed from `OwnedLockHolder` and
        `PlanletLockDependencies`; holder JSON still written with
        `pid: process.pid`; `readOwnedLockHolder` requires only a string token;
        the `process.kill` justification comment removed.
      - Existing lock files (with or without valid pid) still release only on
        token match; contention still fails on EEXIST; full suite green.
- [x] T6 Security L1: clear the brace-expansion advisory with `npm audit fix`
      Acceptance:
      - `npm audit fix` applied; expected lockfile-only change,
        brace-expansion 5.0.8 -> 5.0.9; `package.json` unchanged; no new
        dependencies.
      - `npm audit` reports zero vulnerabilities; `npm ls brace-expansion`
        shows 5.0.9.
      - If npm proposes any `package.json` change or additional package,
        stop and surface before proceeding.
      - Full suite green; final `git diff` contains only the intended source,
        test, planlet, and lockfile changes.

## Completion

- Completed at: 2026-08-05T10:25:48.588Z
- Mode: normal

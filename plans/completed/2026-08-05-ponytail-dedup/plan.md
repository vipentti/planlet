# Ponytail Dedup

## Summary

Consolidate duplicated filesystem-publish, error-mapping, errno-checking, and
name-sorting helpers across `src/`, delete dead code, and clear the one
dev-only `npm audit` advisory. Behavior-preserving only; the existing 211
tests are the contract.

## Scope

- One shared atomic publish-with-rollback helper used by `src/core/creation.ts`,
  `src/core/task-update.ts`, and `src/core/planlet-completion.ts`.
- One shared `asWriteConflict` helper in `src/errors/planlet-error.ts`, replacing
  the four local copies (creation, task-update, planlet-completion,
  harness-installer).
- One shared `errnoIs` helper in `src/core/paths.ts`, replacing the six inline
  errno predicates (paths x2, planlet-lock x2, skill-source, cli).
- One shared `byName` comparator in `src/core/paths.ts`, replacing the five
  sort sites (harness-installer x3, skill-source, read-only).
- Dead code removed: three unreachable `TypeError` guards in
  `src/commands/read-only.ts`, the unreachable `isPlanletError` branch in
  `src/production-entry.ts`, and `pid` dropped from the lock interfaces and
  validation while staying an opaque debug field in the holder JSON.
- `package-lock.json` updated by `npm audit fix` for brace-expansion
  GHSA-rgw5-rvv9-x895.
- Test edits only where direct-call tests pinned removed internals (see
  Risks). CLI outputs, error codes, messages, and rendering are unchanged.

## Out of Scope

- Scripts/help dedup (ponytail findings 5, 7, 8, 13, 14) — separate later PR.
- AGENTS.md "Rejected simplifications" items; the scout report deliberately did
  not flag them and the documented threats hold.
- New dependencies beyond what `npm audit fix` changes.
- `CHANGELOG.md` entry (internal refactor + dev-only dependency change; the PR
  description states the skip per AGENTS.md).

## Approach

Helpers go in modules every caller already imports, so no new files and no new
imports beyond one per helper:

- `atomicPublish(options)` exported from `src/core/paths.ts`. Options:
  `temporaryPath`, `targetPath`, `createTemporary()`, `prepare()`, `rename`,
  `remove`, `onFailure(error)` (per-call-site error mapping), and
  `cleanupFailure { code, message, details, aggregateMessage?, fatal }`.
  Sequence: `createTemporary()` -> `prepare()` -> `rename()`. On failure with
  the temporary created but not published, `remove()` it. On cleanup failure
  with `fatal: true`, throw a cleanup `PlanletError` carrying the configured
  code/message/details and an `AggregateError([onFailure(primary),
  cleanupFailure])` cause (optional aggregate message); with `fatal: false`
  (unused today), keep `cleanupFailed: true` in the primary details and rethrow
  the primary. Otherwise rethrow `onFailure(primary)`. All three call sites
  keep their own error codes/messages/details and pass `fatal: true`.
  - Creation passes `createTemporary: () => mkdirSync(temporaryPath)` and a
    `prepare` that writes both stub files and re-runs the pre-rename collision
    rechecks; task-update and completion pass mode-preserving temp-file writes
    as `createTemporary` (empty `prepare`) and their own rename seam (`rename`
    / `replaceFile`).
- `asWriteConflict(error, message, details)` exported from
  `src/errors/planlet-error.ts`: returns the error unchanged when already a
  `PlanletError`, otherwise builds `write_conflict` with the given message,
  details, and `cause`. The four call sites pass their existing message and
  details bag unchanged.
- `errnoIs(error, ...codes)` exported from `src/core/paths.ts`: true when
  `error` is an `Error` with a string `code` in the given list. Replaces the
  predicates in paths (`isMissingPathError`, the `tryLstat` ENOTDIR check),
  planlet-lock (`isAlreadyExists`, `isNotFound`), skill-source, and cli
  (`hasEntries`).
- `byName(left, right)` exported from `src/core/paths.ts`: codepoint string
  comparator. The five sort sites call it with `left.name`/`right.name` or
  record keys. Ordering is byte-identical to today.
- Dead code: remove the three `TypeError` guards in read-only.ts (cli rejects
  those inputs first), remove the `isPlanletError` branch in
  `renderUnexpectedError` (cli.ts already renders `PlanletError` itself), and
  drop `pid` from `OwnedLockHolder`, `PlanletLockDependencies`, and
  `readOwnedLockHolder` validation while still writing `pid: process.pid` into
  the holder JSON as a debug field.
- Security L1: run `npm audit fix`; expected single lockfile change
  (brace-expansion 5.0.8 -> 5.0.9), no `package.json` change.

## Acceptance Criteria

- `atomicPublish` is the single atomic write/rename/rollback path; each call
  site's error code, message, details, cleanup double-fault (AggregateError
  with both causes), and temporary-creation shape are preserved.
- One `asWriteConflict`; the four call sites render identically.
- One `errnoIs`; no inline `error.code` predicates remain at the named sites.
- One `byName`; sort output is byte-identical.
- read-only.ts has no `TypeError` guards and cli usage errors are unchanged;
  `renderUnexpectedError` handles only non-Planlet errors and cli rendering is
  unchanged; lock holder JSON still contains `pid`, interfaces and validation
  do not reference it, and release still requires a matching token.
- `npm audit` clean; `package.json` dependencies unchanged; lockfile diff
  limited to the audit-fix chain.
- Full suite green: `npm run format:check`, `npm run lint`, `npm run knip`,
  `npm run type-check`, `npm run build`, `npm test`, `git diff --check`.
- No `CHANGELOG.md` entry; PR description states the skip.

## Verification

Strategy only, per repository conventions; results live in the suite and CI,
not in this file:

- Run the full repository suite after each code task and again after T6
  (`npm run format:check`, `npm run lint`, `npm run knip`, `npm run
  type-check`, `npm run build`, `npm test`, `git diff --check`).
- `npm audit` after T6: expect zero vulnerabilities.
- Planlet structural validation plus `git diff` review: only the intended
  source, test, and lockfile changes; no leaked tool-output markup.
- The unchanged fault-injection tests (creation partial write and
  cleanup-failure, task-update rename failure and temp-path collision, lock
  release paths) are the primary evidence of behavior preservation.
- No `## Verification Evidence` section expected: every check is reproducible
  in ordinary history and CI.

## Risks and Considerations

- T1 is the one change worth careful review: the three sites differ in error
  codes/details, rename seam, and temporary-creation shape. Preserve exact
  `PlanletError` codes/messages/details and the AggregateError cause pairing.
  One deliberate equivalence: the completion double-fault AggregateError
  starts with the mapped `asWriteConflict` error instead of the raw fs error;
  the raw error is preserved as its `cause` and no test pins the old shape.
- Test edits are limited to direct-call tests that pinned removed internals;
  CLI-level behavior is unchanged.
- Dropping `pid` validation does not affect lock exclusivity (contention fails
  on EEXIST, not on pid) and release still requires the token match.
- If `npm audit fix` proposes a `package.json` change or additional packages,
  stop and surface before proceeding.

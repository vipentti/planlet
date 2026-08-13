# Reject multiline task continuation

## Summary

Fix issue #73: `tasks.md` currently allows a task to appear as a multiline Markdown list item, but only the physical checkbox line is parsed by `src/core/plan/task-parser.ts:parseTasks`, so `planlet validate` passes while `planlet tasks` is truncated and continuation prose becomes an orphan that survives `task check`. The fix defines the grammar as one physical line per task (`- [ ] T1 <description>`) and adds a validation check that fails on indented continuation text that visually belongs to a task. The check applies to active planlets only, leaving completed archives unchanged.

## Scope

In scope:

- Define `tasks.md` task grammar as one physical line per task. Detailed requirements belong in `plan.md`.
- Enforce the new continuation rule in `src/core/plan/validation.ts:validatePlanletStructure` for active planlets only. Leave `src/core/plan/task-parser.ts:parseTasks` unchanged as line-oriented syntax parsing (uses `TASK_LINE_PATTERN` 9-11 and `parseTaskLine` 27-45, with `TASK_LIKE_LINE_PATTERN` 18-19 for malformed detection). Active-only scope avoids migrating existing completed archives.
- Preserve parser ownership and precedence. `parseTasks` already rejects malformed task-like lines via `TASK_LIKE_LINE_PATTERN` (for example an adjacent indented line such as `  - [ ] T2 Nested` throws `invalid_plan` with details `{ line, content }` and no `taskId`). The new active continuation validation covers only indented followers that `parseTasks` would otherwise silently accept as free-form Markdown. The scan stays after `parseTasks` in `validatePlanletStructure`, so existing parser diagnostics retain precedence and location does not change. The promised `{ taskId, line, content }` diagnostic applies only to silently accepted continuation lines, not to lines the parser already rejects.
- Rule is strictly adjacent: in active validation, for each line recognized by the existing `parseTaskLine`, inspect only the next physical line. Reject when that next line matches the continuation shape. No remembered state beyond the immediate next line, no block-boundary taxonomy. A blank line, heading, or next task line simply does not match the continuation shape on the immediate next line, so no additional classification is needed. This keeps an indented line right after a task rejected and gives a clear test for nested-bullet continuation that is silently accepted.
- Continuation shape is a non-empty line whose leading whitespace is two or more leading spaces, or a tab in the first column only, followed by any spaces or tabs and a non-whitespace character. Matching expression is `/^(?: {2}|\t)[ \t]*\S/`. This regex, prose, and tests use the same definition. A single tab in the first column counts as continuation, a single leading space does not. A plain nested bullet such as `  - Acceptance` matches this shape and is rejected by the new active check, while a task-like nested line such as `  - [ ] T2 Nested` is already rejected by the parser and never reaches the new check.
- On match, throw `PlanletError` with code `invalid_plan` and details `{ taskId, line, content }` where `line` is the one based line number of the continuation line and `content` is that line, consistent with existing malformed-line errors at `src/core/plan/task-parser.ts:54-59` and with `ERROR_EXIT_CODES.invalid_plan` mapping to exit 3 in `src/errors/codes.ts`.
- Preserve backward compatibility for single-line active tasks. Completed archives remain valid under the new validation. In particular, `plans/completed/2026-08-06-copilot-detect-signals/tasks.md` contains indented acceptance sub-bullets immediately after task lines, so `validate --all` and completed reads must keep working with no archive migration.
- Leave `src/core/plan/task-update.ts:replaceTaskMarker` rewrite logic unchanged and do not expose that private helper. Reuse existing integration coverage in `tests/integration/task-update.test.ts` which already verifies marker-only byte-preserving rewrites through the public `updateTask`. Update its shared `MARKDOWN` fixture to keep nested Markdown valid under the new rule (separate the nested Markdown from the task with a blank line) and retain the existing integration assertions. No duplicate rewrite-preservation tests are added.
- Document grammar in `planlet_design.md` section 10.4 and `skills/planlet-plan/assets/tasks-template.md`, and in `README.md` if it describes task syntax, plus a `CHANGELOG.md` `[Unreleased]` entry for this user-visible validation change.
- Tests and CLI integration covering adjacent rejection including two-space and one-tab cases, parser precedence for task-like lines, single-line validity, ordinary Markdown allowance, active-only completed-archive regression, reuse of the existing `updateTask` fixture, and exit 3.

Out of scope:

- Extending `parseTasks` to consume continuation lines into the description (considered alternative in #73, heavier parser scope, deferred).
- Adding a new error code, new file format, new command, or general Markdown AST dependency.
- Changing archive, lock, or completion record mechanics.
- Migrating or reformatting completed archives.
- Adding duplicate rewrite-preservation tests or exposing `replaceTaskMarker`.

## Approach

1. Confirm reproduction from scout report `data/planlet-multiline-task-issue-draft/report.md` and issue #73 against current `src/core/plan/task-parser.ts` and `src/core/plan/validation.ts`. `parseTasks` splits on `/\r?\n/`, matches each line against `TASK_LINE_PATTERN`, and silently skips non-matching continuation lines as free-form Markdown except for task-like lines matched by `TASK_LIKE_LINE_PATTERN` which already throw. `validatePlanletStructure` delegates to `parseTasks` with no continuation guard, so active read paths (`validate`, `tasks`, `status`, `task check`, `complete`) operate on truncated descriptions. `replaceTaskMarker` in `task-update.ts` rewrites only the checkbox line, leaving continuation prose orphaned.

2. Keep `parseTasks` unchanged. Extend `validatePlanletStructure` to enforce the continuation rule for active planlets only, after `parseTasks` and `parseCompletionRecord` have run. When `input.location === "active"`, iterate the original `tasksMarkdown` lines with index. For each line where `parseTaskLine(line)` is non-null, inspect only the next physical line (index + 1). If that next line exists and matches `/^(?: {2}|\t)[ \t]*\S/`, throw `PlanletError("invalid_plan", "Invalid task continuation at line N for T<id>: indented text following a task must be on the task line; move detail to plan.md", { details: { taskId, line: N, content: nextLine } })`. Line numbers are one based. No other lookahead or remembered task state is used. Do not move the scan before `parseTasks`, that would change established malformed-line diagnostics and create location-dependent precedence. When `input.location === "completed"`, skip this check entirely so existing archives validate unchanged. Because the scan is after `parseTasks`, any line that is already task-like and rejected by the parser never reaches this check, preserving the existing `{ line, content }` error shape for those lines.

3. Keep single-line active tasks valid and backward compatible: a task with no indented immediate follower matching `/^(?: {2}|\t)[ \t]*\S/` passes, existing single-line repositories pass unchanged.

4. Ensure `task check` and `task uncheck` on valid single-line active tasks still perform atomic rewrite via existing `replaceTaskMarker` and `atomicPublish` paths without change; validation of the updated file continues to pass because the check remains adjacent and single-line. Reuse the existing `tests/integration/task-update.test.ts` fixture: update its `MARKDOWN` constant so the nested Markdown after a task is separated by a blank line, keeping the fixture valid under the new active rule while retaining all existing byte-preserving assertions through `updateTask`.

5. Update documentation: `planlet_design.md` 10.4 adds a grammar rule stating one physical line per task, that active validation fails on an indented immediate follower matching `/^(?: {2}|\t)[ \t]*\S/` with `invalid_plan` and details `{ taskId, line, content }` for silently accepted continuations, that extended detail belongs in `plan.md`, and that the rule applies to active planlets only with parser precedence preserved. `skills/planlet-plan/assets/tasks-template.md` shows single-line examples and notes the same rule. `README.md` task syntax section mirrors it if present. Add a `CHANGELOG.md` `[Unreleased]` entry describing the new active validation and its exit 3 mapping, per `AGENTS.md` changelog requirements.

6. Add focused tests for the adjacent diagnostic including a two-space indented prose case and a one-tab indented prose case, a plain nested-bullet continuation case (`  - Acceptance` is silently accepted and is rejected by the new check), parser precedence (an adjacent task-like line `  - [ ] T2 Nested` still fails via the parser with `{ line, content }` and no `taskId`), backward compatibility, ordinary Markdown allowance (prose before first task and blank-line-separated paragraph following a task do not trigger because they are not immediately adjacent indented followers), active-only completed-archive regression, reuse of the updated `updateTask` fixture, and CLI integration. No new dependencies.

## Acceptance Criteria

- `parseTasks` remains line-oriented and unchanged and retains its existing `TASK_LIKE_LINE_PATTERN` rejections. The continuation rule is enforced only in `validatePlanletStructure` for active planlets, after `parseTasks`.
- Parser precedence is preserved. A task-like indented follower such as `  - [ ] T2 Nested` still fails via `parseTasks` with `invalid_plan` and details `{ line, content }` without `taskId`. The new `{ taskId, line, content }` diagnostic applies only to indented followers that `parseTasks` would otherwise silently accept.
- In active validation, any task line recognized by `parseTaskLine` whose next physical line matches `/^(?: {2}|\t)[ \t]*\S/` and was not already rejected by the parser fails validation. The check is strictly adjacent, no multi-line lookahead or block-boundary classification.
- Continuation shape is exactly `/^(?: {2}|\t)[ \t]*\S/` meaning two or more leading spaces, or a tab in the first column, followed by any spaces or tabs and a non-whitespace character. A single tab in the first column counts, a single leading space does not. Tests cover a two-space follower, a one-tab follower, and a plain nested-bullet follower `  - Acceptance` that is rejected by the new check.
- Validation for the new continuation case fails with a clear diagnostic that includes the owning task ID and one-based line number of the continuation line, using `PlanletError` code `invalid_plan` with details `{ taskId, line, content }`, mapping to exit 3 via `ERROR_EXIT_CODES.invalid_plan`.
- Single-line active tasks remain valid and existing single-line planlets pass unchanged.
- Ordinary Markdown outside tasks remains allowed when not immediately adjacent as an indented follower: prose before the first task and a blank-line-separated paragraph after a task do not trigger the error. Headings and next task lines also do not trigger because they do not match the continuation shape on the immediate next line.
- Completed archives remain valid. `validate --all` and completed reads do not flag existing indented acceptance sub-bullets such as those in `plans/completed/2026-08-06-copilot-detect-signals/tasks.md`, with no archive migration needed.
- Existing `tests/integration/task-update.test.ts` fixture is updated to keep nested Markdown valid under the new active rule by separating it from the preceding task with a blank line, and its existing `updateTask` byte-preserving assertions continue to pass. No duplicate rewrite-preservation tests are added and `replaceTaskMarker` remains private.
- CLI integration: `planlet validate <slug>` on an active planlet containing an adjacent silently accepted continuation returns `invalidPlan` with exit 3 and structured details naming the task and line; the same content in a completed archive does not fail. A task-like adjacent line still returns the parser error with `{ line, content }`.
- Grammar is documented in `planlet_design.md` section 10.4 and `skills/planlet-plan/assets/tasks-template.md` (and `README.md` where task syntax is described), and `CHANGELOG.md` `[Unreleased]` records the user-visible validation change.

## Verification

Strategy only, results stay in suite and CI. Run the full verification suite in order as defined in `AGENTS.md`:

```sh
npm run format:check
npm run lint
npm run knip
npm run type-check
npm run build
npm test
git diff --check
```

Focused checks for this planlet:

- Unit tests for `validatePlanletStructure` covering: adjacent two-space silently accepted continuation fails with diagnostic naming task ID and continuation line and details `{ taskId, line, content }`; adjacent one-tab continuation fails with the same shape; adjacent plain nested-bullet `  - Acceptance` fails via the new check; adjacent task-like `  - [ ] T2 Nested` fails via the existing parser with `{ line, content }` without `taskId`; single-line active tasks pass; prose before first task and blank-line-separated paragraph after a task do not trigger; heading or next task on the immediate next line does not trigger continuation shape.
- Completed-archive regression: `validatePlanlets` with `all: true` on a fixture containing a completed archive with indented sub-bullets after a task passes, and direct `validatePlanletStructure` with `location: "completed"` on that archive content passes.
- Reuse `tests/integration/task-update.test.ts` with its updated `MARKDOWN` fixture. Assertions for check, uncheck, idempotent, and atomic publication through `updateTask` remain unchanged and pass without exposing `replaceTaskMarker`.
- CLI integration tests: scaffold an active fixture with an adjacent silently accepted continuation, run `node dist/planlet.mjs validate <slug>` and assert exit 3 and `invalid_plan` details with `taskId`; scaffold a task-like adjacent fixture and assert the parser error shape `{ line, content }`; scaffold the same silently accepted content as a completed archive fixture and assert validation passes; confirm existing single-line fixtures still validate with exit 0 and `planlet tasks` remains reachable.
- Manual spot check: `planlet validate multiline-task-rejection` and `planlet status multiline-task-rejection` on the planlet itself remain valid.

No `## Verification Evidence` section is expected for implementation; outcomes are reproducible through suite and review.

## Risks and Considerations

- Tab and whitespace contract must not drift. Prose, regex, and tests all use `/^(?: {2}|\t)[ \t]*\S/` meaning two or more leading spaces, or a tab in the first column, followed by any spaces or tabs and a non-whitespace character. A single tab in the first column counts, a single leading space does not. Tests include both a two-space and a one-tab case plus a plain nested-bullet case to lock the contract. No mixed space-then-tab variant is added because the contract is tab in first column only, keeping prose and regex exactly aligned.
- Scan placement after `parseTasks` preserves parser ownership and precedence and avoids location-dependent behavior. Moving the scan before `parseTasks` would change established malformed-line diagnostics, so it stays after.
- Strictly adjacent scope avoids false positives from blank-line-separated prose and removes the need for a block-boundary taxonomy. Only the immediate next line after a task is inspected, any blank line breaks adjacency and the continuation shape does not match headings or task lines on the next line.
- Active-only scope prevents existing completed archives from becoming invalid. The regression fixture `plans/completed/2026-08-06-copilot-detect-signals/tasks.md` exercises this, no migration of published archives is required and `validate --all` must keep passing.
- Reusing the existing `updateTask` integration fixture avoids duplicate tests and keeps `replaceTaskMarker` private. The fixture update is a blank-line separation, preserving existing byte-preserving assertions.
- Documentation drift: after changing `planlet_design.md` 10.4 and `CHANGELOG.md`, regenerate installed skill copies with `node dist/planlet.mjs update` and commit them, per `AGENTS.md` installed skill copies guidance.
- No em dashes in prose, per repository style.

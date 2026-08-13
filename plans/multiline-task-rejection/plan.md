# Reject multiline task continuation

## Summary

Fix issue #73: `tasks.md` currently allows a task to appear as a multiline Markdown list item, but only the physical checkbox line is parsed by `src/core/plan/task-parser.ts:parseTasks`, so `planlet validate` passes while `planlet tasks` is truncated and continuation prose becomes an orphan that survives `task check`. The fix defines the grammar as one physical line per task (`- [ ] T1 <description>`) and adds a validation check that fails on indented continuation text that visually belongs to a task. The check applies to active planlets only, leaving completed archives unchanged.

## Scope

In scope:

- Define `tasks.md` task grammar as one physical line per task. Detailed requirements belong in `plan.md`.
- Enforce the new continuation rule in `src/core/plan/validation.ts:validatePlanletStructure` for active planlets only. Leave `src/core/plan/task-parser.ts:parseTasks` unchanged as line-oriented syntax parsing (uses `TASK_LINE_PATTERN` 9-11 and `parseTaskLine` 27-45, with `TASK_LIKE_LINE_PATTERN` 18-19 for malformed detection). Active-only scope avoids migrating existing completed archives.
- Rule is strictly adjacent: in active validation, for each line recognized by the existing `parseTaskLine`, inspect only the next physical line. Reject when that next line matches the continuation shape. No remembered state beyond the immediate next line, no block-boundary taxonomy. A blank line, heading, or next task line simply does not match the continuation shape on the immediate next line, so no additional classification is needed. This keeps an indented line right after a task rejected and gives a clear test for nested-bullet continuation.
- Continuation shape is a non-empty line whose leading whitespace is at least two spaces or contains a leading tab before the first non-whitespace character. Matching expression is `/^(?: {2}|\t)[ \t]*\S/` (equivalently, leading whitespace of at least two spaces or at least one tab). This regex, prose, and tests use the same definition, a single tab counts as continuation. Normal prose before the first task or separated by a blank line does not match because it is not immediately adjacent to a task.
- On match, throw `PlanletError` with code `invalid_plan` and details `{ taskId, line, content }`, consistent with existing malformed-line errors at `src/core/plan/task-parser.ts:54-59` and with `ERROR_EXIT_CODES.invalid_plan` mapping to exit 3 in `src/errors/codes.ts`.
- Preserve backward compatibility for single-line active tasks. Completed archives remain valid under the new validation. In particular, `plans/completed/2026-08-06-copilot-detect-signals/tasks.md` contains indented acceptance sub-bullets immediately after task lines, so `validate --all` and completed reads must keep working with no archive migration.
- Leave `src/core/plan/task-update.ts:replaceTaskMarker` rewrite logic unchanged, validation gates the error before mutation.
- Document grammar in `planlet_design.md` section 10.4 and `skills/planlet-plan/assets/tasks-template.md`, and in `README.md` if it describes task syntax, plus a `CHANGELOG.md` `[Unreleased]` entry for this user-visible validation change.
- Tests and CLI integration covering adjacent rejection including two-space and one-tab cases, single-line validity, ordinary Markdown allowance, active-only completed-archive regression, task mutation preservation, and exit 3.

Out of scope:

- Extending `parseTasks` to consume continuation lines into the description (considered alternative in #73, heavier parser scope, deferred).
- Adding a new error code, new file format, new command, or general Markdown AST dependency.
- Changing archive, lock, or completion record mechanics.
- Migrating or reformatting completed archives.

## Approach

1. Confirm reproduction from scout report `data/planlet-multiline-task-issue-draft/report.md` and issue #73 against current `src/core/plan/task-parser.ts` and `src/core/plan/validation.ts`. `parseTasks` splits on `/\r?\n/`, matches each line against `TASK_LINE_PATTERN`, and silently skips non-matching continuation lines as free-form Markdown. `validatePlanletStructure` delegates to `parseTasks` with no continuation guard, so active read paths (`validate`, `tasks`, `status`, `task check`, `complete`) operate on truncated descriptions. `replaceTaskMarker` in `task-update.ts` rewrites only the checkbox line, leaving continuation prose orphaned.

2. Keep `parseTasks` unchanged. Extend `validatePlanletStructure` to enforce the continuation rule for active planlets only. After `parseTasks` and `parseCompletionRecord`, when `input.location === "active"`, iterate the original `tasksMarkdown` lines with index. For each line where `parseTaskLine(line)` is non-null, inspect only the next physical line (index + 1). If that next line exists and matches `/^(?: {2}|\t)[ \t]*\S/`, throw `PlanletError("invalid_plan", "Invalid task continuation at line N for T<id>: indented text following a task must be on the task line; move detail to plan.md", { details: { taskId, line: N, content: nextLine } })`. Line numbers are one based. No other lookahead or remembered task state is used. When `input.location === "completed"`, skip this check entirely so existing archives validate unchanged.

3. Keep single-line active tasks valid and backward compatible: a task with no indented immediate follower passes, existing single-line repositories pass unchanged.

4. Ensure `task check` and `task uncheck` on valid single-line active tasks still perform atomic rewrite via existing `replaceTaskMarker` and `atomicPublish` paths without change; validation of the updated file continues to pass because the check remains adjacent and single-line.

5. Update documentation: `planlet_design.md` 10.4 adds a grammar rule stating one physical line per task, that active validation fails on an indented immediate follower matching `/^(?: {2}|\t)[ \t]*\S/` with `invalid_plan`, that extended detail belongs in `plan.md`, and that the rule applies to active planlets only. `skills/planlet-plan/assets/tasks-template.md` shows single-line examples and notes the same rule. `README.md` task syntax section mirrors it if present. Add a `CHANGELOG.md` `[Unreleased]` entry describing the new active validation and its exit 3 mapping, per `AGENTS.md` changelog requirements.

6. Add focused tests for the adjacent diagnostic including a two-space case and a one-tab case, a nested-bullet continuation case (indented `  - Acceptance` immediately after a task is rejected), backward compatibility, ordinary Markdown allowance (prose before first task and blank-line-separated paragraph following a task do not trigger because they are not immediately adjacent indented followers), active-only completed-archive regression, mutation preservation, and CLI integration. No new dependencies.

## Acceptance Criteria

- `parseTasks` remains line-oriented and unchanged. The continuation rule is enforced only in `validatePlanletStructure` for active planlets.
- In active validation, any task line recognized by `parseTaskLine` whose next physical line matches `/^(?: {2}|\t)[ \t]*\S/` fails validation. The check is strictly adjacent, no multi-line lookahead or block-boundary classification.
- Both a two-space indented follower and a single-tab indented follower are rejected. Tests cover both, plus a nested-bullet follower such as `  - Acceptance` immediately after a task.
- Validation fails with a clear diagnostic that includes the owning task ID and one-based line number of the continuation line, using `PlanletError` code `invalid_plan` with details `{ taskId, line, content }`, mapping to exit 3 via `ERROR_EXIT_CODES.invalid_plan`.
- Single-line active tasks remain valid and existing single-line planlets pass unchanged.
- Ordinary Markdown outside tasks remains allowed when not immediately adjacent as an indented follower: prose before the first task and a blank-line-separated paragraph after a task do not trigger the error. Headings and next task lines also do not trigger because they do not match the continuation shape on the immediate next line.
- Completed archives remain valid. `validate --all` and completed reads do not flag existing indented acceptance sub-bullets such as those in `plans/completed/2026-08-06-copilot-detect-signals/tasks.md`, with no archive migration needed.
- `task check` and `task uncheck` on valid single-line active tasks still perform atomic rewrite and preserve surrounding free-form notes.
- CLI integration: `planlet validate <slug>` on an active planlet containing an adjacent continuation returns `invalidPlan` with exit 3 and structured details naming the task and line; the same content in a completed archive does not fail.
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

- Unit tests for `validatePlanletStructure` covering: adjacent two-space continuation fails with diagnostic naming task ID and continuation line; adjacent one-tab continuation fails; adjacent nested-bullet continuation fails; single-line active tasks pass; prose before first task and blank-line-separated paragraph after a task do not trigger; heading or next task on the immediate next line does not trigger continuation shape.
- Completed-archive regression: `validatePlanlets` with `all: true` on a fixture containing a completed archive with indented sub-bullets after a task passes, and direct `validatePlanletStructure` with `location: "completed"` on that archive content passes.
- Preservation tests for `replaceTaskMarker` and `updateTask` atomic rewrite on valid single-line tasks.
- CLI integration tests: scaffold an active fixture with an adjacent continuation, run `node dist/planlet.mjs validate <slug>` and assert exit 3 and `invalid_plan` details; scaffold the same content as a completed archive fixture and assert validation passes; confirm existing single-line fixtures still validate with exit 0 and `planlet tasks` remains reachable.
- Manual spot check: `planlet validate multiline-task-rejection` and `planlet status multiline-task-rejection` on the planlet itself remain valid.

No `## Verification Evidence` section is expected for implementation; outcomes are reproducible through suite and review.

## Risks and Considerations

- Tab and whitespace contract must not drift. Prose, regex, and tests all use `/^(?: {2}|\t)[ \t]*\S/` meaning at least two leading spaces or a leading tab. A single tab is continuation, a single space is not. Tests include both a two-space and a one-tab case to lock the contract.
- Strictly adjacent scope avoids false positives from blank-line-separated prose and removes the need for a block-boundary taxonomy. Only the immediate next line after a task is inspected, any blank line breaks adjacency and the continuation shape does not match headings or task lines on the next line.
- Active-only scope prevents existing completed archives from becoming invalid. The regression fixture `plans/completed/2026-08-06-copilot-detect-signals/tasks.md` exercises this, no migration of published archives is required and `validate --all` must keep passing.
- Documentation drift: after changing `planlet_design.md` 10.4 and `CHANGELOG.md`, regenerate installed skill copies with `node dist/planlet.mjs update` and commit them, per `AGENTS.md` installed skill copies guidance.
- No em dashes in prose, per repository style.

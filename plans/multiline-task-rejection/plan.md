# Reject multiline task continuation

## Summary

Fix issue #73: `tasks.md` currently allows a task to appear as a multiline Markdown list item, but only the physical checkbox line is parsed by `src/core/plan/task-parser.ts:parseTasks`, so `planlet validate` passes while `planlet tasks` is truncated and continuation prose becomes an orphan that survives `task check`. The preferred fix defines the grammar as one physical line per task (`- [ ] T1 <description>`) and adds a validation check that fails on indented continuation text that visually belongs to a task.

## Scope

In scope:

- Define `tasks.md` task grammar as one physical line per task. Detailed requirements belong in `plan.md`.
- Add a validation error for non-empty lines matching `/^[ \t]{2,}\S/` that immediately follow a recognized task line without an intervening blank line or block boundary (heading, list marker, `## Completion`, `## Verification Evidence`).
- Throw `PlanletError` with code `invalid_plan` and details `{ taskId, line, content }`, consistent with existing malformed-line errors at `src/core/plan/task-parser.ts:54-59` and with `ERROR_EXIT_CODES.invalid_plan` mapping to exit 3 in `src/errors/codes.ts`.
- Preserve backward compatibility for existing single-line tasks and ordinary Markdown outside tasks.
- Place check in `src/core/plan/task-parser.ts:parseTasks` (47-84, uses `TASK_LINE_PATTERN` 9-11 and `parseTaskLine` 27-45, with `TASK_LIKE_LINE_PATTERN` 18-19 for malformed detection) or as a post-parse scan in `src/core/plan/validation.ts:validatePlanletStructure` (which calls `parseTasks`). Prefer extending `parseTasks` so all callers surface the same error.
- Update `src/core/plan/task-update.ts:replaceTaskMarker` behavior implicitly by validation gating, no change to rewrite logic required.
- Document grammar in `planlet_design.md` section 10.4 and `skills/planlet-plan/assets/tasks-template.md`, and in `README.md` if it describes task syntax.
- Tests and CLI integration covering the validation, backward compatibility, ordinary Markdown allowance, task mutation, and exit code.

Out of scope:

- Extending `parseTasks` to consume continuation lines into the description (considered alternative in #73, heavier parser scope, deferred).
- Adding a new error code, new file format, new command, or general Markdown AST dependency.
- Changing archive, lock, or completion record mechanics.

## Approach

1. Confirm reproduction from scout report `data/planlet-multiline-task-issue-draft/report.md` and issue #73 against current `src/core/plan/task-parser.ts` and `src/core/plan/validation.ts`. `parseTasks` splits on `/\r?\n/`, matches each line against `TASK_LINE_PATTERN`, and silently skips non-matching continuation lines as free-form Markdown. `validatePlanletStructure` delegates to `parseTasks` with no continuation guard, so all read paths (`validate`, `tasks`, `status`, `task check`, `complete`) operate on truncated descriptions. `replaceTaskMarker` in `task-update.ts` rewrites only the checkbox line, leaving continuation prose orphaned.

2. Extend `parseTasks` (preferred) to detect continuation after a recognized task. Keep a scan of original lines with index, remember the last recognized task line index and `taskId`. For each subsequent non-empty line that matches `/^[ \t]{2,}\S/` and immediately follows a task without an intervening blank line or block boundary, throw `PlanletError("invalid_plan", "Invalid task continuation at line N for T1: ...", { details: { taskId, line, content } })`. Block boundaries that terminate the check include blank line, heading (`/^#\s/` or `/^##\s/`), new task line (`TASK_LINE_PATTERN`), task-like malformed line, list marker beyond tasks, and section markers `## Completion` and `## Verification Evidence`. This keeps ordinary Markdown allowed: prose before first task, blank-line-separated paragraphs, headings, and plain bullets in evidence or completion remain valid because they are separated by a blank line or heading.

3. Alternatively, implement the same scan as a post-parse step in `validatePlanletStructure` immediately after `parseTasks`. Either location satisfies the requirement that `validate` surfaces the error; document the chosen location and keep error shape identical.

4. Keep single-line tasks valid and backward compatible: no indented follower means no error, existing repositories pass unchanged.

5. Ensure `task check` and `task uncheck` on valid single-line tasks still perform atomic rewrite via existing `replaceTaskMarker` and `atomicPublish` paths without change; validation of the updated file continues to pass.

6. Update documentation: `planlet_design.md` 10.4 adds a grammar rule stating one physical line per task, indented continuation fails validation with `invalid_plan`, and extended detail belongs in `plan.md`; `skills/planlet-plan/assets/tasks-template.md` shows single-line examples and notes the rule; `README.md` task syntax section mirrors it if present.

7. Add focused tests for the diagnostic, backward compatibility, ordinary Markdown allowance, mutation preservation, and CLI integration. No new dependencies.

## Acceptance Criteria

- No valid planlet silently drops text that visually belongs to a task. Any non-empty line matching `/^[ \t]{2,}\S/` that immediately follows a recognized task line without an intervening blank line or block boundary fails validation.
- Validation fails with a clear diagnostic that includes the owning task ID and line number, using `PlanletError` code `invalid_plan` with details `{ taskId, line, content }`, consistent with existing malformed-line errors and mapping to exit 3 via `ERROR_EXIT_CODES.invalid_plan`.
- Single-line tasks remain valid and existing planlets with only single-line tasks pass validation unchanged.
- Ordinary Markdown outside tasks remains allowed: prose before the first task, blank-line-separated paragraphs between tasks, headings, and plain bullets or prose inside `## Verification Evidence` and `## Completion` do not trigger the continuation error.
- `task check` and `task uncheck` on valid single-line tasks still perform atomic rewrite and preserve surrounding free-form notes.
- CLI integration: `planlet validate <slug>` on a planlet containing a multiline continuation returns `invalidPlan` with exit 3 and structured details naming the task.
- Grammar is documented in `planlet_design.md` section 10.4 and `skills/planlet-plan/assets/tasks-template.md` (and `README.md` where task syntax is described).

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

- Unit tests for `parseTasks` and `validatePlanletStructure` covering: multiline task fails validate with diagnostic naming `T1` and line; single-line tasks pass; ordinary Markdown allowance cases (prose before first task, blank-line-separated paragraph, heading, evidence plain bullets, completion record) do not trigger.
- Preservation tests for `replaceTaskMarker` and `updateTask` atomic rewrite on valid tasks.
- CLI integration tests: scaffold a fixture with a multiline continuation, run `node dist/planlet.mjs validate <slug>` and assert exit 3 and `invalid_plan` details; confirm `planlet tasks` is not reachable as valid when continuation exists; confirm existing single-line fixtures still validate with exit 0.
- Manual spot check: `planlet validate multiline-task-rejection` and `planlet status multiline-task-rejection` on the planlet itself remain valid.

No `## Verification Evidence` section is expected for implementation; outcomes are reproducible through suite and review.

## Risks and Considerations

- False positives if the detector is too broad. Mitigate by requiring immediate follower (no blank line) and indent at least two spaces or a tab with non-whitespace, terminated by any block boundary. This mirrors the scout recommendation and avoids flagging ordinary separated prose.
- Existing completed archives contain acceptance sub-bullets indented two spaces immediately after a task line (for example `2026-08-06-copilot-detect-signals` tasks). Those bullets are blank-line-free followers and would be flagged under the new rule. Verify that published archives are treated as historical and either remain valid by excluding `## Completion` scope or by documenting that new validation applies only to active planlets; prefer scoping the error to active validation path if needed, but keep the invalid plan code and exit mapping unchanged.
- Choosing between `parseTasks` and `validatePlanletStructure` for the scan: `parseTasks` gives consistent behavior for direct callers, `validatePlanletStructure` isolates the rule to lifecycle validation. Pick one and document it; error shape stays the same.
- Documentation drift: after changing `planlet_design.md` 10.4, regenerate installed skill copies with `node dist/planlet.mjs update` and commit them, per `AGENTS.md` installed skill copies guidance.
- No em dashes in prose, per repository style.

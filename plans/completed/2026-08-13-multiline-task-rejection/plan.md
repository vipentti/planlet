# Support soft-wrapped task descriptions

## Summary

Fix issue #73: `tasks.md` allows a task to appear as a multiline Markdown list item, but only the physical checkbox line is parsed by `src/core/plan/task-parser.ts:parseTasks`, so `planlet validate` passes while `planlet tasks` is truncated and continuation prose becomes an orphan that survives `task check`. Most of the harm is formatter induced: a valid single-line task formatted with Prettier `proseWrap: "always"` and normal `printWidth` can be wrapped into an indented continuation line with no change in Markdown meaning, so persisted format validity must not depend on whether the host repository enables that formatting option.

The fix makes the logical task model insensitive to harmless soft wrapping. A recognized task keeps one physical checkbox line as the marker, but its description may soft-wrap across following indented paragraph-continuation lines belonging to the same list item. `parseTasks` consumes those following lines and normalizes their whitespace into the parsed description. New Markdown block or list constructs and blank lines end the description. Nested checkbox syntax stays invalid via existing parser precedence, and `task check`/`uncheck` stays byte-preserving on the checkbox line.

## Scope

In scope:

- Support narrow soft-wrapped descriptions instead of requiring one physical line per task. One physical checkbox line per task as the marker stays required, description text may soft-wrap across following indented paragraph-continuation lines.
- Consume and normalize indented paragraph-continuation lines in `src/core/plan/task-parser.ts:parseTasks` (uses `TASK_LINE_PATTERN` 9-11, `parseTaskLine` 27-45, `TASK_LIKE_LINE_PATTERN` 18-19). Stop consuming at blank lines or new Markdown block or list constructs (blank line, heading `#{1,6} `, unordered list `- ` `* ` `+ `, ordered list `1. `, blockquote `> `) so nested bullets and headings remain separate Markdown. Keep `TASK_LIKE_LINE_PATTERN` precedence: an indented line that looks like a malformed task such as `  - [ ] T2 Nested` is still rejected as `invalid_plan` with details `{ line, content }` and no `taskId` before consumption applies.
- Normalize whitespace: strip leading indent and surrounding whitespace from each consumed continuation line, join to the base description with a single space, so `planlet tasks` returns the complete normalized description for a wrapped task.
- Keep `src/core/plan/task-update.ts:replaceTaskMarker` byte-preserving: `task check` and `task uncheck` change only the physical checkbox line, continuation bytes are untouched. Validation of the updated file still passes because the logical description is derived from the unchanged continuation bytes.
- Keep single-line tasks valid and ordinary Markdown outside tasks unaffected. Completed archives remain valid without migration, since consumed lines are only plain paragraph continuations, and acceptance sub-bullets such as those in `plans/completed/2026-08-06-copilot-detect-signals/tasks.md` start with `  - ` and are treated as a new list construct that ends consumption.
- No formatter-specific ignore config, no front matter, no schema version, no migration machinery. No new error code, no new file format, no new command, no Markdown AST dependency.
- Document grammar in `planlet_design.md` 10.4 and `skills/planlet-plan/assets/tasks-template.md`, update `CHANGELOG.md` `[Unreleased]` for this user-visible behavior.
- Tests covering actual Prettier `proseWrap: "always"` wrapped output, normalized `tasks` output, byte-preserving check and uncheck, nested checkbox precedence, single-line validity, and ordinary Markdown allowance.

Out of scope:

- Formatter ignore configuration or `prettier-ignore` comments.
- Front matter, schema versions, or migration of existing archives.
- Extending `tasks.md` to support nested task trees or explicit dependencies.
- Changing archive, lock, or completion record mechanics.
- Adding new CLI commands or changing the completion lifecycle.

## Approach

1. Confirm reproduction from issue #73 and current code inspection of `src/core/plan/task-parser.ts` and `src/core/plan/validation.ts`. Inline reproduction without a host Prettier config: format a single-line task with Prettier programmatically (`parser: "markdown"`, `proseWrap: "always"`, `printWidth: 80`) and observe the wrapped form: a task such as `- [ ] T1 This is a very long task description that definitely exceeds the default print width ...` becomes two physical lines, the second indented by 6 spaces (`"      default print width..."`). Current `parseTasks` stops at the first line, so `planlet tasks` truncates and `validate` passes. `replaceTaskMarker` in `task-update.ts` would then leave the continuation as orphan prose after a check.

2. Decide consumption site from code: `parseTasks` is the description producer, so it owns continuation consumption. Keep `TASK_LIKE_LINE_PATTERN` rejection first. Do not add a new `validatePlanletStructure` check; remove the active-only adjacent indented-continuation rejection added in the earlier draft (`src/core/plan/validation.ts` reject scan). The new behavior belongs in the parser so `validate`, `tasks`, `status`, `task check`, `complete`, and completed reads all see the same normalized description.

3. Implement consumption in `parseTasks`:
   - Iterate the split lines `markdown.split(/\r?\n/)` with an index so consumed lines can be skipped.
   - When `parseTaskLine(line)` is non-null, capture its base description and task id. Then peek forward while the next line exists:
     - If `TASK_LIKE_LINE_PATTERN.test(nextLine)` then throw `PlanletError("invalid_plan", "Malformed task line at line N", { details: { line: N, content: nextLine } })` preserving the existing shape and precedence.
     - Else if `nextLine` is blank (`/^[ \t]*$/`) or starts a new block or list construct after optional indent (`/^[ \t]*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/` or `/^[ \t]*[-*+]\s/` handling the `  - Acceptance` case) then break, do not consume.
     - Else if `nextLine` matches indented paragraph continuation `/^(?: {2}|\t)[ \t]*\S/` then strip leading and trailing whitespace (`nextLine.trim()`) and append to the task description with a single space, advance the index to skip that line, and continue peeking for further wrapped lines.
     - Else break.
   - Freeze the task with the normalized description and continue to the next unconsumed line. Duplicate task ID and other existing checks remain unchanged.

4. Keep `task-update.ts:replaceTaskMarker` unchanged and private. It already rewrites only the checkbox line via `split(/(?<=\n)/)` and `parseTaskLine`. Since continuation bytes are not part of the checkbox line, `updateTask` through the public `updateTask` path remains byte-preserving for wrapped tasks. Reuse the existing `tests/integration/task-update.test.ts` fixture for the basic byte-preserving assertions, and add coverage that checks continuation bytes are untouched after a check or uncheck on a wrapped task.

5. Update documentation: `planlet_design.md` 10.4 states one physical checkbox line per task, description may soft-wrap across following indented paragraph-continuation lines that are consumed and normalized, blank lines or new block or list constructs end the description, nested checkbox stays invalid, extended detail still belongs in `plan.md` when it is more than a wrapped sentence. `skills/planlet-plan/assets/tasks-template.md` shows single-line examples and notes the same soft-wrap rule. `CHANGELOG.md` `[Unreleased]` records the user-visible parsing change.

6. Add focused tests:
   - Unit: generate a wrapped task using Prettier with `proseWrap: "always"`, `printWidth: 80`, `parser: "markdown"` and assert `parseTasks` (and `validatePlanletStructure` via `tasks`) yields the single normalized description and `planlet tasks` returns the complete text.
   - Unit and CLI: wrapped task still validates (exit 0), single-line tasks remain valid, ordinary Markdown (prose before first task, blank-line-separated paragraph, heading, next task) unaffected, indented paragraph continuation after a task is consumed, `  - ` style nested bullet ends consumption and stays separate Markdown.
   - Unit precedence: `  - [ ] T2 Nested` immediately after a task still fails as `invalid_plan` with `{ line, content }` and no `taskId`.
   - Integration: `task check` and `task uncheck` on a wrapped task preserve continuation bytes, `validate --all` and completed reads still pass for the completed archive with acceptance bullets, and no formatter-ignore directives are required.

## Acceptance Criteria

- `parseTasks` consumes following indented paragraph-continuation lines belonging to the same list item into the task description, normalizing whitespace with single spaces. A blank line, heading, or new list or block construct ends the description.
- A wrapped task produced by Prettier `proseWrap: "always"` at normal width is parsed as a single task with the complete normalized description. `planlet tasks <slug>` returns that complete description.
- `TASK_LIKE_LINE_PATTERN` precedence is preserved. An indented follower such as `  - [ ] T2 Nested` immediately after a task still fails with `invalid_plan` and details `{ line, content }` without `taskId`, whether or not the outer task would otherwise consume.
- `task check` and `task uncheck` on a valid wrapped task perform a byte-preserving atomic rewrite that changes only the checkbox line, leaving continuation bytes untouched, and the revalidated file still passes.
- Single-line active tasks remain valid, and existing single-line planlets pass unchanged without formatting.
- Ordinary Markdown outside tasks remains allowed: prose before first task, blank-line-separated paragraph after a task, heading, or next task line do not get merged into the preceding task.
- A plain nested bullet such as `  - Acceptance` after a task is treated as a new list construct that ends consumption and remains separate free-form Markdown, so existing completed archives such as `plans/completed/2026-08-06-copilot-detect-signals/tasks.md` stay valid with no migration.
- No formatter ignore config, front matter, schema version, or archive migration is required for correctness under `proseWrap: "always"`.
- Grammar is documented in `planlet_design.md` 10.4 and `skills/planlet-plan/assets/tasks-template.md`, and `CHANGELOG.md` `[Unreleased]` records the user-visible parsing change.

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

- Unit `parseTasks` and `validatePlanletStructure`: parse a Prettier-wrapped task (generated with actual Prettier `proseWrap: "always"`) and assert single task with normalized description. Assert `planlet tasks` would return the same complete text. Verify `  - [ ] T2 Nested` after a task still throws `invalid_plan` with `{ line, content }` and no `taskId`. Verify `  - Acceptance` after a task is not merged. Verify multiple continuation lines are concatenated. Verify blank-line-separated indented text is not consumed.
- Integration `task-update`: reuse `tests/integration/task-update.test.ts` MARKDOWN fixture and add a wrapped-task fixture, assert check and uncheck preserve continuation bytes via `updateTask` public path, without exposing `replaceTaskMarker`.
- CLI integration: scaffold an active planlet containing a Prettier-wrapped task, run `node dist/planlet.mjs validate <slug>` and `tasks <slug>` and assert exit 0 and complete normalized description. Scaffold a task-like adjacent fixture and assert parser error `{ line, content }`. Confirm `validate --all` on a completed archive with indented acceptance sub-bullets still passes.
- Manual spot check: `planlet validate multiline-task-rejection` and `planlet status multiline-task-rejection` on the planlet itself remain valid.

No `## Verification Evidence` section is expected for implementation; outcomes are reproducible through suite and review.

## Risks and Considerations

- Parser ownership keeps the fix formatter-stable. Implementing consumption in `parseTasks` rather than in `validatePlanletStructure` ensures every read path (`validate`, `tasks`, `status`, `task check`, `complete`) sees the same normalized description, and no persisted format needs a migration step.
- Precedence must not drift. `TASK_LIKE_LINE_PATTERN` is checked before continuation consumption so nested checkbox syntax stays invalid with the same diagnostic shape.
- New block or list boundary detection must be narrow. Only blank lines and lines that start a new block or list after optional indent end consumption, so plain paragraph wraps are consumed but headings and nested bullets are not. Keep prose, regex, and tests aligned.
- Byte-preserving mutation keeps the fix non-destructive. `replaceTaskMarker` stays private and changes only the checkbox line, so a formatted long task does not lose its wrapping after a check.
- No formatter-ignore or front-matter workaround is introduced per reviewer guidance, the logical model itself is made insensitive to wrapping.
- Documentation drift: after changing `planlet_design.md` 10.4 and `CHANGELOG.md`, regenerate installed skill copies with `node dist/planlet.mjs update` and commit them, per `AGENTS.md`.
- No em dashes in prose, per repository style.

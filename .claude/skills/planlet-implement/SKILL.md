---
name: planlet-implement
description: Implement and verify exactly one active repository-local Planlet while updating its task checklist incrementally. Use when a user asks to execute a persisted planlet, continue its implementation, or report and advance its remaining work without archiving it.
---

# Planlet Implement

Implement one persisted planlet and keep its progress truthful.

## Start the workflow

1. Discover the repository root without traversing above its boundary.
2. Determine whether the required `planlet` show, validate, tasks, and task-check operations are available. Prefer available operations; do not reproduce their deterministic work.
3. If any required operation is unavailable, announce the narrow repository-local fallback and name the CLI inspection, validation, or progress checks that cannot run.
4. Resolve exactly one active planlet. Accept one valid explicit slug. With no slug, select the sole active planlet and announce it; report none when none exist; ask the user to choose when several exist. Never select by recency or directory order.
5. Re-read the selected `plan.md` and `tasks.md` completely from disk and validate them before changing product code.

## Implement

1. Inspect current repository instructions, code, tests, and working-tree changes relevant to the plan. Preserve user work.
2. Compare current conditions with the persisted plan. Read [implementation guidance](references/implementation-guidance.md) for drift, task, and pause decisions.
3. Work through tasks in a sensible dependency order. Limit mutations to this planlet and its implementation scope.
4. Verify each task with checks proportionate to its outcome. Mark it complete immediately after both implementation and relevant verification succeed; leave failed or unverified tasks unchecked.
5. Use the CLI task-check operation when available. Otherwise update only the exact recognized task line in `tasks.md`, preserve its ID and text, normalize the checked marker to `[x]`, write safely, and re-read the file. Treat checking an already checked task as successful without duplicating content.
6. Reinspect progress after each update. If new work materially expands scope, update the plan and tasks only with user approval or pause for direction.

Pause rather than guess when the plan is materially stale, a task has multiple consequential interpretations, verification fails without an in-scope remedy, required authority is missing, or safe progress would expand scope. Record evidence and keep affected tasks unchecked.

Do not implement multiple planlets, infer completion from malformed or missing files, or archive the planlet unless the user explicitly requested a separate completion workflow.

## Finish

Report the logical slug, implemented outcomes, task IDs checked during this run, exact verification and results, deviations or blockers, and remaining task IDs. State whether the planlet is ready to complete. When fallback was used, repeat which deterministic CLI checks were unavailable.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ERROR_EXIT_CODES,
  EXIT_CODES,
  type ErrorCode,
} from "../../src/errors/codes.js";
import {
  PlanletError,
  isPlanletError,
} from "../../src/errors/planlet-error.js";

test("each error code is locked to its exact exit-code category", () => {
  const expected: Record<ErrorCode, number> = {
    repo_not_found: EXIT_CODES.operational,
    plans_not_initialized: EXIT_CODES.operational,
    invalid_slug: EXIT_CODES.usage,
    plan_not_found: EXIT_CODES.operational,
    plan_already_exists: EXIT_CODES.stateTransition,
    completed_plan_exists: EXIT_CODES.stateTransition,
    invalid_plan: EXIT_CODES.invalidPlan,
    task_not_found: EXIT_CODES.operational,
    duplicate_task_id: EXIT_CODES.invalidPlan,
    incomplete_tasks: EXIT_CODES.stateTransition,
    archive_collision: EXIT_CODES.stateTransition,
    unsupported_tool: EXIT_CODES.usage,
    unsafe_path: EXIT_CODES.filesystemConflict,
    write_conflict: EXIT_CODES.filesystemConflict,
    internal_error: EXIT_CODES.operational,
  };

  for (const code of Object.keys(ERROR_EXIT_CODES) as ErrorCode[]) {
    assert.equal(ERROR_EXIT_CODES[code], expected[code], code);
  }
});

test("PlanletError retains structured details and next action", () => {
  const error = new PlanletError("task_not_found", "Task does not exist", {
    details: { slug: "cli-core", taskId: "T99" },
    next: "planlet tasks cli-core",
  });

  assert.ok(isPlanletError(error));
  assert.equal(error.name, "PlanletError");
  assert.deepEqual(error.toStructuredError(), {
    code: "task_not_found",
    message: "Task does not exist",
    details: { slug: "cli-core", taskId: "T99" },
    next: "planlet tasks cli-core",
  });
  assert.ok(Object.isFrozen(error.details));
});

test("PlanletError omits an absent next action from structured output", () => {
  const error = new PlanletError("repo_not_found", "No repository");
  assert.deepEqual(error.toStructuredError(), {
    code: "repo_not_found",
    message: "No repository",
    details: {},
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { PLANLET_STATES, createPlanSummary } from "../../src/core/models.js";

test("plan summaries preserve advisory warnings separately from state", () => {
  const sourceWarnings = ["Missing recommended Verification section"];
  const summary = createPlanSummary({
    slug: "cli-core",
    state: "in_progress",
    completedTasks: 2,
    totalTasks: 4,
    path: "/repo/plans/cli-core",
    warnings: sourceWarnings,
  });

  sourceWarnings.push("later mutation");

  assert.deepEqual(summary.warnings, [
    "Missing recommended Verification section",
  ]);
  assert.equal(summary.state, "in_progress");
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary.warnings));
});

test("plan summaries reject impossible task counts", () => {
  assert.throws(
    () =>
      createPlanSummary({
        slug: "cli-core",
        state: "in_progress",
        completedTasks: 5,
        totalTasks: 4,
        path: "/repo/plans/cli-core",
      }),
    /cannot exceed/,
  );
  assert.throws(
    () =>
      createPlanSummary({
        slug: "cli-core",
        state: "planned",
        completedTasks: 1,
        totalTasks: 4,
        path: "/repo/plans/cli-core",
      }),
    /none completed/,
  );
});

test("completed summaries require archive identity and timestamp", () => {
  assert.throws(
    () =>
      createPlanSummary({
        slug: "cli-core",
        state: "completed",
        completedTasks: 4,
        totalTasks: 4,
        path: "/repo/plans/completed/2026-07-24-cli-core",
      }),
    /archiveName and completedAt/,
  );
});

test("the lifecycle state model exposes the designed stable values", () => {
  assert.deepEqual(PLANLET_STATES, [
    "invalid",
    "draft",
    "planned",
    "in_progress",
    "ready_to_complete",
    "completed",
  ]);
});

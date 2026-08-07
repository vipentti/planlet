import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidUtcTimestamp,
  parseCompletionRecord,
} from "../../src/core/plan/completion.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

test("completion parsing accepts normal and incomplete override records", () => {
  assert.deepEqual(
    parseCompletionRecord(
      "# Tasks\n\n## Completion\n\n- Completed at: 2026-07-22T12:34:56Z\n- Mode: normal\n",
    ),
    {
      completedAt: "2026-07-22T12:34:56Z",
      mode: "normal",
      remainingTaskIds: [],
    },
  );
  assert.deepEqual(
    parseCompletionRecord(
      "# Tasks\n\n## Completion\n\n- Completed at: 2026-07-22T12:34:56.123Z\n- Mode: incomplete override\n- Remaining tasks: T2, T4\n- Reason: Deferred by approval\n",
    ),
    {
      completedAt: "2026-07-22T12:34:56.123Z",
      mode: "incomplete override",
      remainingTaskIds: ["T2", "T4"],
      reason: "Deferred by approval",
    },
  );
});

test("completion parsing rejects invalid timestamps, modes, and override fields", () => {
  assert.equal(isValidUtcTimestamp("2026-02-29T12:00:00Z"), false);
  assert.equal(isValidUtcTimestamp("2026-07-22T12:00:00+00:00"), false);

  for (const record of [
    "- Completed at: 2026-02-29T12:00:00Z\n- Mode: normal",
    "- Completed at: 2026-07-22T12:00:00Z\n- Mode: forced",
    "- Completed at: 2026-07-22T12:00:00Z\n- Mode: incomplete override\n- Remaining tasks: T2",
    "- Completed at: 2026-07-22T12:00:00Z\n- Mode: incomplete override\n- Remaining tasks: T2, T2\n- Reason: Deferred",
  ]) {
    assert.throws(
      () => parseCompletionRecord(`# Tasks\n\n## Completion\n\n${record}\n`),
      (error) => error instanceof PlanletError && error.code === "invalid_plan",
    );
  }
});

test("tasks without a completion section return no completion record", () => {
  assert.equal(parseCompletionRecord("# Tasks\n\n- [ ] T1 Work\n"), null);
});

test("a near-miss completion heading is recognized instead of ignored", () => {
  assert.deepEqual(
    parseCompletionRecord(
      "# Tasks\n\n##   completion  \n\n- Completed at: 2026-07-22T12:34:56Z\n- Mode: normal\n",
    ),
    {
      completedAt: "2026-07-22T12:34:56Z",
      mode: "normal",
      remainingTaskIds: [],
    },
  );
});

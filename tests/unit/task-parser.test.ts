import assert from "node:assert/strict";
import test from "node:test";

import { PlanletError } from "../../src/errors/planlet-error.js";
import { parseTaskLine, parseTasks } from "../../src/core/task-parser.js";

test("task parsing recognizes only exact top-level checklist lines", () => {
  assert.deepEqual(parseTaskLine("- [ ] T12 Ship the parser"), {
    id: "T12",
    description: "Ship the parser",
    completed: false,
  });
  assert.deepEqual(parseTaskLine("- [X] T2 Verify uppercase markers"), {
    id: "T2",
    description: "Verify uppercase markers",
    completed: true,
  });
  assert.equal(parseTaskLine("  - [ ] T3 Nested task"), null);
  assert.deepEqual(parseTaskLine("- [ ] T4 Trailing space accepted "), {
    id: "T4",
    description: "Trailing space accepted",
    completed: false,
  });
  assert.equal(parseTaskLine("ordinary Markdown"), null);
});

test("task parsing preserves order and derives progress", () => {
  const parsed = parseTasks(
    `# Tasks\n\n- [x] T8 Done\nnotes\n- [ ] T3 Pending`,
  );

  assert.deepEqual(parsed.tasks, [
    { id: "T8", description: "Done", completed: true },
    { id: "T3", description: "Pending", completed: false },
  ]);
  assert.equal(parsed.completedCount, 1);
  assert.deepEqual(parsed.remainingTaskIds, ["T3"]);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.tasks));
});

test("malformed top-level checklist lines are structural errors", () => {
  for (const line of [
    "- [ ] T1",
    "- [y] T1 Work",
    "- [ ] no-id",
    "- [ ]T3 Missing space after checkbox",
    "  - [ ] T4 Indented recognized task",
    "- [] T5 Empty checkbox",
  ]) {
    assert.throws(
      () => parseTasks(`# Tasks\n\n${line}`),
      (error) => error instanceof PlanletError && error.code === "invalid_plan",
      line,
    );
  }
});

test("free-form bracketed notes are not mistaken for malformed tasks", () => {
  const parsed = parseTasks(
    `# Tasks\n\n- [ ] T1 Real task\n- [see the design doc] a note\n- [TODO] follow up later`,
  );

  assert.deepEqual(parsed.tasks, [
    { id: "T1", description: "Real task", completed: false },
  ]);
});

test("duplicate task IDs produce the dedicated structured error", () => {
  assert.throws(
    () => parseTasks("# Tasks\n\n- [ ] T2 First\n- [x] T2 Second"),
    (error) =>
      error instanceof PlanletError &&
      error.code === "duplicate_task_id" &&
      error.details.taskId === "T2",
  );
});

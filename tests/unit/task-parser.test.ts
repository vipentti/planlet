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

test("a free-form verification evidence section stays opaque to the parser", () => {
  const parsed = parseTasks(
    "# Tasks\n\n- [x] T1 Shipped outcome\n- [ ] T2 External release\n\n" +
      "## Verification Evidence\n\n" +
      "- Published `example-tool` 1.4.0; the registry refuses republishing that version.\n" +
      "  Tarball digest `sha512-3Qk1n0Ye`.\n" +
      "- The signing key rotation could not be verified: the previous key was already\n" +
      "  destroyed, so T2 remains unchecked.\n",
  );

  assert.deepEqual(parsed.tasks, [
    { id: "T1", description: "Shipped outcome", completed: true },
    { id: "T2", description: "External release", completed: false },
  ]);
  assert.equal(parsed.completedCount, 1);
  assert.deepEqual(parsed.remainingTaskIds, ["T2"]);
});

test("a checkbox-shaped evidence bullet is rejected as a malformed task line", () => {
  assert.throws(
    () =>
      parseTasks(
        "# Tasks\n\n- [ ] T1 External release\n\n" +
          "## Verification Evidence\n\n" +
          "- [ ] CI release gate pending\n",
      ),
    (error) =>
      error instanceof PlanletError &&
      error.code === "invalid_plan" &&
      error.details.line === 7,
  );
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

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkTask, uncheckTask } from "../../src/commands/task-update.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withPlanlet(
  tasksMarkdown: string,
  run: (root: string, tasksPath: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-task-update-"));
  const planletPath = join(root, "plans", "fixture-plan");
  const tasksPath = join(planletPath, "tasks.md");
  mkdirSync(join(root, ".git"));
  mkdirSync(planletPath, { recursive: true });
  writeFileSync(join(planletPath, "plan.md"), "# Fixture Plan\n");
  writeFileSync(tasksPath, tasksMarkdown);
  try {
    run(root, tasksPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const MARKDOWN =
  "# Tasks: Fixture Plan\r\n" +
  "\r\n" +
  "Intro paragraph with [brackets] and **formatting**.\r\n" +
  "\r\n" +
  "- [ ] T1 First task\r\n" +
  "- [x] T2 Second task\r\n" +
  "  - [ ] Nested Markdown stays untouched\r\n" +
  "\r\n" +
  "## Notes\r\n" +
  "\r\n" +
  "- [see plan.md] This is not a task.\r\n";

test("check is idempotent and preserves every unrelated Markdown byte", () => {
  withPlanlet(MARKDOWN, (root, tasksPath) => {
    const first = checkTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
    });
    const expected = MARKDOWN.replace(
      "- [ ] T1 First task",
      "- [x] T1 First task",
    );

    assert.equal(first.changed, true);
    assert.equal(first.task.completed, true);
    assert.equal(readFileSync(tasksPath, "utf8"), expected);

    const second = checkTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
    });
    assert.equal(second.changed, false);
    assert.equal(readFileSync(tasksPath, "utf8"), expected);
  });
});

test("uncheck is idempotent and changes only the selected marker", () => {
  withPlanlet(MARKDOWN, (root, tasksPath) => {
    const first = uncheckTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T2",
    });
    const expected = MARKDOWN.replace(
      "- [x] T2 Second task",
      "- [ ] T2 Second task",
    );

    assert.equal(first.changed, true);
    assert.equal(first.task.completed, false);
    assert.equal(readFileSync(tasksPath, "utf8"), expected);

    const second = uncheckTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T2",
    });
    assert.equal(second.changed, false);
    assert.equal(readFileSync(tasksPath, "utf8"), expected);
  });
});

test("a failed atomic publication preserves tasks.md and removes its sibling temp file", () => {
  withPlanlet(MARKDOWN, (root, tasksPath) => {
    const temporaryName = ".fixture-plan.tasks-fixture.tmp";
    assert.throws(
      () =>
        checkTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          dependencies: {
            temporaryName: () => temporaryName,
            rename: () => {
              throw new Error("simulated rename failure");
            },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );

    assert.equal(readFileSync(tasksPath, "utf8"), MARKDOWN);
    assert.deepEqual(readdirSync(join(root, "plans", "fixture-plan")).sort(), [
      "plan.md",
      "tasks.md",
    ]);
  });
});

test("an existing temporary-path collision preserves the unowned file", () => {
  withPlanlet(MARKDOWN, (root, tasksPath) => {
    const planletPath = join(root, "plans", "fixture-plan");
    const temporaryName = ".fixture-plan.tasks-collision.tmp";
    const temporaryPath = join(planletPath, temporaryName);
    const existingContent = "owned by another operation\n";
    writeFileSync(temporaryPath, existingContent);

    assert.throws(
      () =>
        checkTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          dependencies: {
            temporaryName: () => temporaryName,
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );

    assert.equal(readFileSync(tasksPath, "utf8"), MARKDOWN);
    assert.equal(readFileSync(temporaryPath, "utf8"), existingContent);
  });
});

test("missing tasks and malformed planlets fail without modifying Markdown", () => {
  withPlanlet(MARKDOWN, (root, tasksPath) => {
    assert.throws(
      () =>
        checkTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T99",
        }),
      (error) =>
        error instanceof PlanletError && error.code === "task_not_found",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), MARKDOWN);
  });

  const malformed =
    "# Tasks: Fixture Plan\n\n- [ ] T1 First\n- [x] T1 Duplicate\n";
  withPlanlet(malformed, (root, tasksPath) => {
    assert.throws(
      () =>
        checkTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
        }),
      (error) =>
        error instanceof PlanletError && error.code === "duplicate_task_id",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), malformed);
  });
});

test("task updates refuse planlet directory symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-task-symlink-"));
  const target = join(root, "target");
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "plans"));
  mkdirSync(target);
  writeFileSync(join(target, "plan.md"), "# Fixture Plan\n");
  writeFileSync(join(target, "tasks.md"), "# Tasks\n\n- [ ] T1 Pending\n");
  symlinkSync(target, join(root, "plans", "fixture-plan"), "dir");
  try {
    assert.throws(
      () =>
        checkTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
        }),
      (error) => error instanceof PlanletError && error.code === "unsafe_path",
    );
    assert.equal(
      readFileSync(join(target, "tasks.md"), "utf8"),
      "# Tasks\n\n- [ ] T1 Pending\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("task mutations cannot diverge from an active completion record", () => {
  const incompleteOverride =
    "# Tasks: Fixture Plan\n\n- [ ] T1 Pending\n\n## Completion\n\n- Completed at: 2026-07-22T12:34:56Z\n- Mode: incomplete override\n- Remaining tasks: T1\n- Reason: Interrupted archive\n";
  withPlanlet(incompleteOverride, (root, tasksPath) => {
    assert.throws(
      () =>
        checkTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
        }),
      (error) =>
        error instanceof PlanletError &&
        error.code === "invalid_plan" &&
        error.next === "planlet complete fixture-plan",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), incompleteOverride);
  });

  const normal =
    "# Tasks: Fixture Plan\n\n- [x] T1 Done\n\n## Completion\n\n- Completed at: 2026-07-22T12:34:56Z\n- Mode: normal\n";
  withPlanlet(normal, (root, tasksPath) => {
    assert.throws(
      () =>
        uncheckTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
        }),
      (error) => error instanceof PlanletError && error.code === "invalid_plan",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), normal);
  });
});

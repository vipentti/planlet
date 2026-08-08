import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

import { updateTask } from "../../src/core/plan/task-update.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withPlanlet(
  tasksMarkdown: string,
  run: (root: string, tasksPath: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-task-update-"));
  const planletPath = join(root, "plans", "fixture-plan");
  const tasksPath = join(planletPath, "tasks.md");
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  mkdirSync(planletPath, { recursive: true });
  writeFileSync(join(planletPath, "plan.md"), "# Fixture Plan\n");
  writeFileSync(tasksPath, tasksMarkdown);
  try {
    run(root, tasksPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function porcelain(root: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

function commitAll(root: string, message: string): void {
  const add = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync(
    "git",
    [
      "-c",
      "user.email=planlet@test",
      "-c",
      "user.name=Planlet Test",
      "commit",
      "-qm",
      message,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(commit.status, 0, commit.stderr);
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
    const first = updateTask({
      operation: "check",
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

    const second = updateTask({
      operation: "check",
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
    const first = updateTask({
      operation: "uncheck",
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

    const second = updateTask({
      operation: "uncheck",
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T2",
    });
    assert.equal(second.changed, false);
    assert.equal(readFileSync(tasksPath, "utf8"), expected);
  });
});

test("task update results report post-write lifecycle summary", () => {
  withPlanlet(
    "# Tasks: Fixture Plan\n\n- [ ] T1 First\n- [ ] T2 Second\n",
    (root) => {
      const first = updateTask({
        operation: "check",
        repositoryRoot: root,
        slug: "fixture-plan",
        taskId: "T1",
      });
      assert.equal(first.changed, true);
      assert.equal(first.state, "in_progress");
      assert.equal(first.done, 1);
      assert.equal(first.total, 2);
      assert.equal(first.next, undefined);

      const final = updateTask({
        operation: "check",
        repositoryRoot: root,
        slug: "fixture-plan",
        taskId: "T2",
      });
      assert.equal(final.state, "ready_to_complete");
      assert.equal(final.done, 2);
      assert.equal(final.total, 2);
      assert.equal(final.next, "planlet complete fixture-plan");

      const idempotent = updateTask({
        operation: "check",
        repositoryRoot: root,
        slug: "fixture-plan",
        taskId: "T2",
      });
      assert.equal(idempotent.changed, false);
      assert.equal(idempotent.state, "ready_to_complete");
      assert.equal(idempotent.done, 2);
      assert.equal(idempotent.total, 2);
      assert.equal(idempotent.next, "planlet complete fixture-plan");

      const unchecked = updateTask({
        operation: "uncheck",
        repositoryRoot: root,
        slug: "fixture-plan",
        taskId: "T2",
      });
      assert.equal(unchecked.state, "in_progress");
      assert.equal(unchecked.done, 1);
      assert.equal(unchecked.total, 2);
      assert.equal(unchecked.next, undefined);

      const idempotentUncheck = updateTask({
        operation: "uncheck",
        repositoryRoot: root,
        slug: "fixture-plan",
        taskId: "T2",
      });
      assert.equal(idempotentUncheck.changed, false);
      assert.equal(idempotentUncheck.state, "in_progress");
      assert.equal(idempotentUncheck.done, 1);
      assert.equal(idempotentUncheck.total, 2);
      assert.equal(idempotentUncheck.next, undefined);
    },
  );
});

test("a failed atomic publication preserves tasks.md and removes its sibling temp file", () => {
  withPlanlet(MARKDOWN, (root, tasksPath) => {
    const temporaryName = ".fixture-plan.tasks-fixture.tmp";
    assert.throws(
      () =>
        updateTask({
          operation: "check",
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
        updateTask({
          operation: "check",
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
        updateTask({
          operation: "check",
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
        updateTask({
          operation: "check",
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
        updateTask({
          operation: "check",
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
        updateTask({
          operation: "check",
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
        updateTask({
          operation: "uncheck",
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
        }),
      (error) => error instanceof PlanletError && error.code === "invalid_plan",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), normal);
  });
});

test("task check stages only tasks.md in a git repository", () => {
  withPlanlet(MARKDOWN, (root, tasksPath) => {
    commitAll(root, "base");
    writeFileSync(join(root, "unrelated.txt"), "keep unstaged\n");

    const result = updateTask({
      operation: "check",
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
    });

    assert.equal(result.changed, true);
    assert.deepEqual(porcelain(root).sort(), [
      "?? unrelated.txt",
      "M  plans/fixture-plan/tasks.md",
    ]);
    assert.equal(
      readFileSync(tasksPath, "utf8").includes("- [x] T1 First task"),
      true,
    );
  });
});

test("task check with stage disabled leaves tasks.md unstaged", () => {
  withPlanlet(MARKDOWN, (root) => {
    commitAll(root, "base");

    const result = updateTask({
      operation: "check",
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      stage: false,
    });

    assert.equal(result.changed, true);
    assert.deepEqual(porcelain(root), [" M plans/fixture-plan/tasks.md"]);
  });
});

test("an unchanged task update stages nothing", () => {
  withPlanlet(MARKDOWN, (root) => {
    commitAll(root, "base");

    const result = updateTask({
      operation: "check",
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T2",
    });

    assert.equal(result.changed, false);
    assert.deepEqual(porcelain(root), []);
  });
});

test("task updates make no git call in a non-git root", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-task-nongit-"));
  const planletPath = join(root, "plans", "fixture-plan");
  const tasksPath = join(planletPath, "tasks.md");
  mkdirSync(planletPath, { recursive: true });
  writeFileSync(join(planletPath, "plan.md"), "# Fixture Plan\n");
  writeFileSync(tasksPath, MARKDOWN);
  try {
    const result = updateTask({
      operation: "check",
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
    });

    assert.equal(result.changed, true);
    assert.equal(
      result.warnings.some((warning) => warning.startsWith("Could not stage")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a git failure becomes a warning and the update still succeeds", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-task-gitfail-"));
  const planletPath = join(root, "plans", "fixture-plan");
  const tasksPath = join(planletPath, "tasks.md");
  writeFileSync(join(root, ".git"), "gitdir: /nonexistent\n");
  mkdirSync(planletPath, { recursive: true });
  writeFileSync(join(planletPath, "plan.md"), "# Fixture Plan\n");
  writeFileSync(tasksPath, MARKDOWN);
  try {
    const result = updateTask({
      operation: "check",
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
    });

    assert.equal(result.changed, true);
    assert.equal(
      result.warnings.some((warning) =>
        warning.startsWith("Could not stage tasks.md"),
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

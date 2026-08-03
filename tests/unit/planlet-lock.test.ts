import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completePlanlet } from "../../src/core/planlet-completion.js";
import {
  planletLockPath,
  plantPlanletLock,
} from "../../src/core/planlet-lock.js";
import { updateTask } from "../../src/core/task-update.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

const PLAN = "# Fixture Plan\n";
const TASKS =
  "# Tasks: Fixture Plan\n\n- [ ] T1 First\n- [ ] T2 Second\n- [x] T3 Done\n";

function withRepo(run: (root: string, tasksPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-lock-"));
  const planletPath = join(root, "plans", "fixture-plan");
  mkdirSync(join(root, ".git"));
  mkdirSync(planletPath, { recursive: true });
  writeFileSync(join(planletPath, "plan.md"), PLAN);
  writeFileSync(join(planletPath, "tasks.md"), TASKS);
  try {
    run(root, join(planletPath, "tasks.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("competing task update fails with write_conflict while lock is held", () => {
  withRepo((root, tasksPath) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });

    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          operation: "check",
          dependencies: {
            lock: { isProcessAlive: () => true },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
  });
});

test("task update racing completion lock fails with write_conflict", () => {
  withRepo((root, tasksPath) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: 1,
      createdAt: new Date().toISOString(),
    });

    assert.throws(
      () =>
        completePlanlet({
          repositoryRoot: root,
          slug: "fixture-plan",
          allowIncomplete: true,
          reason: "blocked",
          dependencies: {
            now: () => new Date("2026-07-22T12:00:00Z"),
            lock: { isProcessAlive: () => true },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          operation: "check",
          dependencies: {
            lock: { isProcessAlive: () => true },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
  });
});

test("dead-holder locks are reclaimed so a later update can proceed", () => {
  withRepo((root, tasksPath) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: 999_999_999,
      createdAt: new Date().toISOString(),
    });

    const result = updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      operation: "check",
      dependencies: {
        lock: { isProcessAlive: () => false },
      },
    });
    assert.equal(result.changed, true);
    assert.match(readFileSync(tasksPath, "utf8"), /\[x\] T1/);
    assert.equal(existsSync(planletLockPath(root, "fixture-plan")), false);
  });
});

test("lock is released when the operation throws", () => {
  withRepo((root) => {
    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T99",
          operation: "check",
        }),
      (error) =>
        error instanceof PlanletError && error.code === "task_not_found",
    );
    assert.equal(existsSync(planletLockPath(root, "fixture-plan")), false);

    const result = updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      operation: "check",
    });
    assert.equal(result.changed, true);
  });
});

test("barrier-ordered contention refuses stale second write then applies both checks", () => {
  withRepo((root, tasksPath) => {
    // Agent A holds the lock (live PID). Agent B's stale RMW attempt fails
    // with write_conflict instead of overwriting. After A releases, both
    // checks apply without lost updates.
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      pid: 1001,
      createdAt: "2026-07-22T12:00:00.000Z",
    });

    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T2",
          operation: "check",
          dependencies: {
            lock: { isProcessAlive: () => true },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);

    rmSync(lockPath, { recursive: true, force: true });

    updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      operation: "check",
    });
    updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T2",
      operation: "check",
    });

    const final = readFileSync(tasksPath, "utf8");
    assert.match(final, /\[x\] T1/);
    assert.match(final, /\[x\] T2/);
  });
});

test("injected acquire failure surfaces as write_conflict", () => {
  withRepo((root, tasksPath) => {
    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          operation: "check",
          dependencies: {
            lock: {
              mkdir: () => {
                const error = new Error("disk full") as NodeJS.ErrnoException;
                error.code = "ENOSPC";
                throw error;
              },
            },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
  });
});

test("lock directories reject symlink escapes", () => {
  withRepo((root) => {
    const outside = mkdtempSync(join(tmpdir(), "planlet-lock-outside-"));
    try {
      mkdirSync(join(root, "plans", ".planlet-locks"), { recursive: true });
      symlinkSync(
        outside,
        join(root, "plans", ".planlet-locks", "fixture-plan"),
      );
      assert.throws(
        () =>
          updateTask({
            repositoryRoot: root,
            slug: "fixture-plan",
            taskId: "T1",
            operation: "check",
          }),
        (error) =>
          error instanceof PlanletError && error.code === "unsafe_path",
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

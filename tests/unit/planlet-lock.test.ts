import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completePlanlet } from "../../src/core/planlet-completion.js";
import {
  PLANLET_LOCK_DIR,
  PLANLET_LOCK_HOLDER,
  acquirePlanletLock,
  planletLockPath,
  releasePlanletLock,
  type PlanletLockHolder,
  withPlanletLock,
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

function plantPlanletLock(
  repositoryRoot: string,
  slug: string,
  holder: PlanletLockHolder,
): string {
  const root = join(repositoryRoot, "plans", PLANLET_LOCK_DIR);
  mkdirSync(root, { recursive: true });
  const lockPath = planletLockPath(repositoryRoot, slug);
  mkdirSync(lockPath);
  writeFileSync(
    join(lockPath, PLANLET_LOCK_HOLDER),
    `${JSON.stringify(holder)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return lockPath;
}

test("competing task update fails with write_conflict while lock is held", () => {
  withRepo((root, tasksPath) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      token: "live-holder",
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
      token: "held",
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
      token: "dead",
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
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      pid: 1001,
      createdAt: "2026-07-22T12:00:00.000Z",
      token: "a",
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
      mkdirSync(join(root, "plans", PLANLET_LOCK_DIR), { recursive: true });
      symlinkSync(
        outside,
        join(root, "plans", PLANLET_LOCK_DIR, "fixture-plan"),
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

test("corrupt holder metadata is not treated as reclaimable", () => {
  withRepo((root, tasksPath) => {
    const lockPath = planletLockPath(root, "fixture-plan");
    mkdirSync(join(root, "plans", PLANLET_LOCK_DIR), { recursive: true });
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, PLANLET_LOCK_HOLDER), "{not-json\n");

    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          operation: "check",
          dependencies: { lock: { isProcessAlive: () => false } },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
    assert.equal(existsSync(lockPath), true);
  });
});

test("only one of two reclaimers wins the quarantine rename race", () => {
  withRepo((root) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: 42,
      createdAt: "2026-07-22T12:00:00.000Z",
      token: "stale",
    });

    let renameCount = 0;
    const rename = (source: string, destination: string): void => {
      renameCount += 1;
      if (renameCount === 1) {
        renameSync(source, destination);
        return;
      }
      const error = new Error("busy") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    };

    const first = acquirePlanletLock(root, "fixture-plan", {
      isProcessAlive: () => false,
      rename,
      createToken: () => `token-${renameCount + 1}`,
    });
    assert.equal(existsSync(first.path), true);

    assert.throws(
      () =>
        acquirePlanletLock(root, "fixture-plan", {
          isProcessAlive: () => false,
          rename,
          createToken: () => "loser",
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );

    // First owner's lock must still be present with its token.
    const holder = JSON.parse(
      readFileSync(join(first.path, PLANLET_LOCK_HOLDER), "utf8"),
    ) as PlanletLockHolder;
    assert.equal(holder.token, first.token);
    releasePlanletLock(first);
  });
});

test("stale reclaimer cannot delete a newly acquired live lock on release", () => {
  withRepo((root) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: 7,
      createdAt: "2026-07-22T12:00:00.000Z",
      token: "old",
    });

    const winner = acquirePlanletLock(root, "fixture-plan", {
      isProcessAlive: () => false,
      createToken: () => "winner-token",
    });

    // Simulate a previous owner's finally-block releasing after losing reclaim.
    releasePlanletLock({ path: winner.path, token: "old" });
    assert.equal(existsSync(winner.path), true);
    const holder = JSON.parse(
      readFileSync(join(winner.path, PLANLET_LOCK_HOLDER), "utf8"),
    ) as PlanletLockHolder;
    assert.equal(holder.token, "winner-token");

    releasePlanletLock(winner);
    assert.equal(existsSync(winner.path), false);
  });
});

test("ownership-token mismatch during release leaves the replacement lock", () => {
  withRepo((root) => {
    const handle = acquirePlanletLock(root, "fixture-plan", {
      createToken: () => "owner-a",
    });
    releasePlanletLock({ path: handle.path, token: "someone-else" });
    assert.equal(existsSync(handle.path), true);
    releasePlanletLock(handle);
  });
});

test("isProcessAlive treats Windows-style dead PID codes as dead", () => {
  withRepo((root, tasksPath) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: 12345,
      createdAt: new Date().toISOString(),
      token: "win-dead",
    });

    const result = updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      operation: "check",
      dependencies: {
        lock: {
          isProcessAlive: (pid) => {
            // Mimic default classification: EINVAL means dead on Windows.
            void pid;
            return false;
          },
        },
      },
    });
    assert.equal(result.changed, true);
    assert.match(readFileSync(tasksPath, "utf8"), /\[x\] T1/);
  });
});

test("withPlanletLock releases only the caller's owned lock after a throw", () => {
  withRepo((root) => {
    assert.throws(
      () =>
        withPlanletLock(root, "fixture-plan", () => {
          throw new Error("boom");
        }),
      (error) => error instanceof Error && error.message === "boom",
    );
    assert.equal(existsSync(planletLockPath(root, "fixture-plan")), false);
  });
});

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
  acquireOwnedLock,
  isProcessAlive,
  releaseOwnedLock,
  withPlanletLock,
  type OwnedLockHolder,
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

function lockPathFor(repositoryRoot: string, slug: string): string {
  return join(repositoryRoot, "plans", PLANLET_LOCK_DIR, slug);
}

function plantPlanletLock(
  repositoryRoot: string,
  slug: string,
  holder: OwnedLockHolder,
): string {
  const root = join(repositoryRoot, "plans", PLANLET_LOCK_DIR);
  mkdirSync(root, { recursive: true });
  const lockPath = lockPathFor(repositoryRoot, slug);
  mkdirSync(lockPath);
  writeFileSync(
    join(lockPath, PLANLET_LOCK_HOLDER),
    `${JSON.stringify(holder)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return lockPath;
}

function acquirePlanletLock(
  repositoryRoot: string,
  slug: string,
  dependencies: Parameters<typeof acquireOwnedLock>[3] = {},
) {
  return acquireOwnedLock(
    join(repositoryRoot, "plans", PLANLET_LOCK_DIR),
    slug,
    slug,
    dependencies,
  );
}

test("competing task update fails with write_conflict while lock is held", () => {
  withRepo((root, tasksPath) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: process.pid,
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
    assert.equal(existsSync(lockPathFor(root, "fixture-plan")), false);
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
    assert.equal(existsSync(lockPathFor(root, "fixture-plan")), false);

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
    const lockPath = lockPathFor(root, "fixture-plan");
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

    const holder = JSON.parse(
      readFileSync(join(first.path, PLANLET_LOCK_HOLDER), "utf8"),
    ) as OwnedLockHolder;
    assert.equal(holder.token, first.token);
    releaseOwnedLock(first);
  });
});

test("stale reclaimer cannot delete a newly acquired live lock on release", () => {
  withRepo((root) => {
    plantPlanletLock(root, "fixture-plan", {
      pid: 7,
      token: "old",
    });

    const winner = acquirePlanletLock(root, "fixture-plan", {
      isProcessAlive: () => false,
      createToken: () => "winner-token",
    });

    releaseOwnedLock({ path: winner.path, token: "old" });
    assert.equal(existsSync(winner.path), true);
    const holder = JSON.parse(
      readFileSync(join(winner.path, PLANLET_LOCK_HOLDER), "utf8"),
    ) as OwnedLockHolder;
    assert.equal(holder.token, "winner-token");

    releaseOwnedLock(winner);
    assert.equal(existsSync(winner.path), false);
  });
});

test("ownership-token mismatch during release leaves the replacement lock", () => {
  withRepo((root) => {
    const handle = acquirePlanletLock(root, "fixture-plan", {
      createToken: () => "owner-a",
    });
    releaseOwnedLock({ path: handle.path, token: "someone-else" });
    assert.equal(existsSync(handle.path), true);
    releaseOwnedLock(handle);
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
    assert.equal(existsSync(lockPathFor(root, "fixture-plan")), false);
  });
});

test("withPlanletLock preserves the operation error when release fails", () => {
  withRepo((root) => {
    assert.throws(
      () =>
        withPlanletLock(
          root,
          "fixture-plan",
          () => {
            throw new PlanletError("task_not_found", "missing");
          },
          {
            remove: () => {
              throw new Error("release failed");
            },
          },
        ),
      (error) =>
        error instanceof PlanletError && error.code === "task_not_found",
    );
  });
});

test("successful operation with failed release returns a release warning", () => {
  withRepo((root, tasksPath) => {
    const result = updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      operation: "check",
      dependencies: {
        lock: {
          remove: () => {
            throw new Error("release failed");
          },
        },
      },
    });
    assert.equal(result.changed, true);
    assert.match(readFileSync(tasksPath, "utf8"), /\[x\] T1/);
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("Lock release failed"),
      ),
    );
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes(lockPathFor(root, "fixture-plan")),
      ),
    );
    assert.equal(existsSync(lockPathFor(root, "fixture-plan")), true);
  });
});

test("missing planlet does not create a lock directory before plan_not_found", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-lock-missing-"));
  try {
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "plans"), { recursive: true });
    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "absent",
          taskId: "T1",
          operation: "check",
        }),
      (error) =>
        error instanceof PlanletError && error.code === "plan_not_found",
    );
    assert.equal(existsSync(join(root, "plans", PLANLET_LOCK_DIR)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isProcessAlive classifies alive, permission, dead, and unknown codes", () => {
  assert.equal(isProcessAlive(process.pid), true);

  const classify = (code: string): boolean => {
    const original = process.kill;
    (process as { kill: typeof process.kill }).kill = (() => {
      const error = new Error(code) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    }) as typeof process.kill;
    try {
      return isProcessAlive(1);
    } finally {
      process.kill = original;
    }
  };

  assert.equal(classify("EPERM"), true);
  assert.equal(classify("EACCES"), true);
  assert.equal(classify("ESRCH"), false);
  assert.equal(classify("ENOENT"), false);
  assert.equal(classify("EINVAL"), false);
  assert.equal(classify("EIO"), true);
  assert.equal(classify("ENOSYS"), true);
});

test("unknown probe result leaves the lock untouched", () => {
  withRepo((root, tasksPath) => {
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      pid: 55,
      token: "maybe-live",
    });
    let renamed = false;

    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          operation: "check",
          dependencies: {
            lock: {
              isProcessAlive: () => true,
              rename: (source, destination) => {
                renamed = true;
                renameSync(source, destination);
              },
            },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(renamed, false);
    assert.equal(existsSync(lockPath), true);
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
  });
});

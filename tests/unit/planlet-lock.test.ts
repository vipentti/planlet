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

import { renderUnexpectedError } from "../../src/production-entry.js";
import { completePlanlet } from "../../src/core/planlet-completion.js";
import {
  acquireOwnedLock,
  isProcessAlive,
  planletLockRoot,
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
    rmSync(planletLockRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

function lockPathFor(repositoryRoot: string, slug: string): string {
  return join(planletLockRoot(repositoryRoot), slug);
}

function plantPlanletLock(
  repositoryRoot: string,
  slug: string,
  holder: OwnedLockHolder,
): string {
  const root = planletLockRoot(repositoryRoot);
  mkdirSync(root, { recursive: true });
  const lockPath = lockPathFor(repositoryRoot, slug);
  writeFileSync(lockPath, `${JSON.stringify(holder)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return lockPath;
}

function acquirePlanletLock(
  repositoryRoot: string,
  slug: string,
  dependencies: Parameters<typeof acquireOwnedLock>[3] = {},
) {
  return acquireOwnedLock(
    planletLockRoot(repositoryRoot),
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
              write: () => {
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
      mkdirSync(planletLockRoot(root), { recursive: true });
      symlinkSync(outside, join(planletLockRoot(root), "fixture-plan"));
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
    mkdirSync(planletLockRoot(root), { recursive: true });
    writeFileSync(lockPath, "{not-json\n");

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

test("failed publication leaves no lock and a later acquire succeeds", () => {
  withRepo((root) => {
    const lockPath = lockPathFor(root, "fixture-plan");
    assert.throws(
      () =>
        acquirePlanletLock(root, "fixture-plan", {
          write: () => {
            throw new Error("interrupted");
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(existsSync(lockPath), false);

    const handle = acquirePlanletLock(root, "fixture-plan");
    assert.equal(existsSync(lockPath), true);
    releaseOwnedLock(handle);
    assert.equal(existsSync(lockPath), false);
  });
});

test("a reclaim that cannot remove the dead holder reports contention", () => {
  withRepo((root) => {
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      pid: 42,
      token: "stale",
    });

    assert.throws(
      () =>
        acquirePlanletLock(root, "fixture-plan", {
          isProcessAlive: () => false,
          remove: () => {
            throw new Error("busy");
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );

    const holder = JSON.parse(
      readFileSync(lockPath, "utf8"),
    ) as OwnedLockHolder;
    assert.equal(holder.token, "stale");
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
    });

    releaseOwnedLock({ path: winner.path, token: "old" });
    assert.equal(existsSync(winner.path), true);
    const holder = JSON.parse(
      readFileSync(winner.path, "utf8"),
    ) as OwnedLockHolder;
    assert.equal(holder.token, winner.token);

    releaseOwnedLock(winner);
    assert.equal(existsSync(winner.path), false);
  });
});

test("ownership-token mismatch during release leaves the replacement lock", () => {
  withRepo((root) => {
    const handle = acquirePlanletLock(root, "fixture-plan");
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

test("withPlanletLock reports both the operation error and a failed release", () => {
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
      (error) => {
        // Must stay a PlanletError: a bare AggregateError reaches the CLI
        // boundary as internal_error and the lock path is never printed.
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "task_not_found");
        assert.equal(error.message, "missing");
        assert.equal(error.details.lockPath, lockPathFor(root, "fixture-plan"));
        assert.equal(error.details.lockReleaseFailed, true);
        assert.ok(error.next?.includes(lockPathFor(root, "fixture-plan")));
        const cause = error.cause;
        assert.ok(cause instanceof AggregateError);
        assert.ok(cause.errors[0] instanceof PlanletError);
        assert.equal(cause.errors[0].code, "task_not_found");
        assert.equal(cause.errors[1].message, "release failed");
        return true;
      },
    );
  });
});

test("a failed release surfaces through the production entry with its code", () => {
  withRepo((root) => {
    let thrown: unknown;
    try {
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
      );
    } catch (error) {
      thrown = error;
    }
    const rendered = renderUnexpectedError(thrown);
    // The rendered path is escaped per platform, so match the recovery hint
    // rather than the raw path; the sibling test pins the path in `next`.
    assert.match(rendered.stderr, /task_not_found/);
    assert.match(rendered.stderr, /lockReleaseFailed/);
    assert.match(rendered.stderr, /only if no process still holds it/);
    assert.doesNotMatch(rendered.stderr, /internal_error/);
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
    assert.equal(existsSync(planletLockRoot(root)), false);
  } finally {
    rmSync(planletLockRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("isProcessAlive reclaims only on ESRCH and treats everything else as alive", () => {
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

  assert.equal(classify("ESRCH"), false);
  assert.equal(classify("EPERM"), true);
  assert.equal(classify("EACCES"), true);
  assert.equal(classify("EIO"), true);
  assert.equal(classify("ENOSYS"), true);
});

test("unknown probe result leaves the lock untouched", () => {
  withRepo((root, tasksPath) => {
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      pid: 55,
      token: "maybe-live",
    });
    let removed = false;

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
              remove: (path) => {
                removed = true;
                rmSync(path, { recursive: true, force: true });
              },
            },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(removed, false);
    assert.equal(existsSync(lockPath), true);
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
  });
});

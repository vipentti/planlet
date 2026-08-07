import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completePlanlet } from "../../src/core/plan/planlet-completion.js";
import {
  acquireOwnedLock,
  planletLockRoot,
  releaseOwnedLock,
  withPlanletLock,
  type OwnedLockHolder,
} from "../../src/core/planlet-lock.js";
import { updateTask } from "../../src/core/plan/task-update.js";
import { PlanletError } from "../../src/errors/planlet-error.js";
import { renderToonError } from "../../src/output/toon.js";

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
      token: "live-holder",
    });

    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          operation: "check",
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
      token: "held",
    });

    assert.throws(
      () =>
        completePlanlet({
          repositoryRoot: root,
          slug: "fixture-plan",
          allowIncomplete: true,
          reason: "blocked",
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
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
  });
});

test("dead-holder locks are not reclaimed automatically", () => {
  withRepo((root, tasksPath) => {
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      token: "dead",
    });

    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T1",
          operation: "check",
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
    assert.equal(existsSync(lockPath), true);
    const holder = JSON.parse(
      readFileSync(lockPath, "utf8"),
    ) as OwnedLockHolder;
    assert.equal(holder.token, "dead");
  });
});

test("two reclaimers of one dead lock cannot both acquire", () => {
  withRepo((root) => {
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      token: "dead",
    });
    const rootDir = planletLockRoot(root);
    const holders: string[] = [];
    let removes = 0;

    // Models the old remove-then-create race: both contenders would clear the
    // dead path and both would then create. With reclaim gone, neither clears,
    // so both stay in write_conflict and the planted holder is untouched.
    const race = () =>
      acquireOwnedLock(rootDir, "fixture-plan", "fixture-plan", {
        remove: (path) => {
          removes += 1;
          rmSync(path, { recursive: true, force: true });
        },
        write: (path, contents) => {
          writeFileSync(path, contents, { encoding: "utf8", flag: "wx" });
          holders.push(JSON.parse(contents).token);
        },
      });

    assert.throws(
      () => race(),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.throws(
      () => race(),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(removes, 0);
    assert.deepEqual(holders, []);
    assert.equal(
      (JSON.parse(readFileSync(lockPath, "utf8")) as OwnedLockHolder).token,
      "dead",
    );
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
      token: "a",
    });

    assert.throws(
      () =>
        updateTask({
          repositoryRoot: root,
          slug: "fixture-plan",
          taskId: "T2",
          operation: "check",
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

test(
  "an existing permissive lock root is tightened before use",
  { skip: process.platform === "win32" ? "POSIX modes only" : false },
  () => {
    withRepo((root) => {
      const lockRoot = planletLockRoot(root);
      // What an upgrade from a version that created the namespace without a mode
      // looks like: ours, but world-readable.
      mkdirSync(lockRoot, { recursive: true, mode: 0o755 });
      assert.equal(statSync(lockRoot).mode & 0o777, 0o755);

      const handle = acquirePlanletLock(root, "fixture-plan");
      assert.equal(statSync(lockRoot).mode & 0o777, 0o700);
      releaseOwnedLock(handle);
    });
  },
);

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

test("pre-existing lock file is never cleared by acquire", () => {
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

test("ownership-checked release cannot delete a successor lock", () => {
  withRepo((root) => {
    const lockPath = lockPathFor(root, "fixture-plan");
    const stale = acquirePlanletLock(root, "fixture-plan");

    // Mistaken manual recovery: path cleared while the old holder still thinks
    // it owns the lock, then a successor acquires.
    rmSync(lockPath, { recursive: true, force: true });
    const winner = acquirePlanletLock(root, "fixture-plan");

    // Interleave the old release after the successor is in place. A
    // read-then-unlink release would delete winner's lock here; rename-aside
    // restores the successor when the quarantined token does not match.
    const quarantine = `${lockPath}.${stale.token}.releasing`;
    releaseOwnedLock(stale);

    assert.equal(existsSync(lockPath), true);
    assert.equal(existsSync(quarantine), false);
    const holder = JSON.parse(
      readFileSync(lockPath, "utf8"),
    ) as OwnedLockHolder;
    assert.equal(holder.token, winner.token);

    releaseOwnedLock(winner);
    assert.equal(existsSync(lockPath), false);
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

test("failed initial release rename with a successful operation returns a warning", () => {
  withRepo((root, tasksPath) => {
    const renameError = Object.assign(new Error("busy"), { code: "EBUSY" });
    const result = updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      operation: "check",
      dependencies: {
        lock: {
          rename: () => {
            throw renameError;
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
    assert.equal(existsSync(lockPathFor(root, "fixture-plan")), true);
  });
});

test("failed initial release rename with a failed operation keeps both faults", () => {
  withRepo((root) => {
    const renameError = Object.assign(new Error("access denied"), {
      code: "EACCES",
    });
    assert.throws(
      () =>
        withPlanletLock(
          root,
          "fixture-plan",
          () => {
            throw new PlanletError("task_not_found", "missing");
          },
          {
            rename: () => {
              throw renameError;
            },
          },
        ),
      (error) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "task_not_found");
        assert.equal(error.details.lockReleaseFailed, true);
        assert.equal(error.details.lockPath, lockPathFor(root, "fixture-plan"));
        const cause = error.cause;
        assert.ok(cause instanceof AggregateError);
        assert.equal(cause.errors[1], renameError);
        return true;
      },
    );
    assert.equal(existsSync(lockPathFor(root, "fixture-plan")), true);
  });
});

test("missing lock during release rename is a silent no-op", () => {
  withRepo((root) => {
    const handle = acquirePlanletLock(root, "fixture-plan");
    rmSync(handle.path, { force: true });
    releaseOwnedLock(handle);
    assert.equal(existsSync(handle.path), false);
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
    const rendered = renderToonError(
      (thrown as PlanletError).toStructuredError(),
    );
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

test("missing planlet still reports plan_not_found and leaves no lock behind", () => {
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
    // The namespace directory is created now that the check happens under the
    // lock; what must not survive is the lock itself.
    assert.equal(existsSync(join(planletLockRoot(root), "absent")), false);
  } finally {
    rmSync(planletLockRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing lock is left untouched on contention", () => {
  withRepo((root, tasksPath) => {
    const lockPath = plantPlanletLock(root, "fixture-plan", {
      token: "maybe-live",
    });
    let removed = false;
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
              remove: (path) => {
                removed = true;
                rmSync(path, { recursive: true, force: true });
              },
              rename: (from, to) => {
                renamed = true;
                renameSync(from, to);
              },
            },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(removed, false);
    assert.equal(renamed, false);
    assert.equal(existsSync(lockPath), true);
    assert.equal(readFileSync(tasksPath, "utf8"), TASKS);
  });
});

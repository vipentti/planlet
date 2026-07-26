import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { complete } from "../../src/commands/complete.js";
import { validatePlanletStructure } from "../../src/core/validation.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

const PLAN =
  "# Fixture Plan\n\n## Summary\nFixture.\n\n## Scope\nFixture.\n\n## Approach\nFixture.\n\n## Acceptance Criteria\n- Works.\n\n## Verification\nTests.\n";

function withRepository(
  tasksMarkdown: string,
  run: (root: string, source: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-completion-"));
  const source = join(root, "plans", "fixture-plan");
  mkdirSync(join(root, ".git"));
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "plan.md"), PLAN);
  writeFileSync(join(source, "tasks.md"), tasksMarkdown);
  try {
    run(root, source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const COMPLETE_TASKS =
  "# Tasks: Fixture Plan\n\n- [x] T1 First task\n- [x] T2 Second task\n";
const INCOMPLETE_TASKS =
  "# Tasks: Fixture Plan\n\n- [x] T1 First task\n- [ ] T2 Second task\n- [ ] T4 Fourth task\n";

test("normal completion uses one UTC instant for its audit and archive date", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    let clockReads = 0;
    const result = complete({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: {
        now: () => {
          clockReads += 1;
          return new Date("2027-01-02T00:00:00.125Z");
        },
      },
    });
    const destination = join(
      realpathSync(root),
      "plans",
      "completed",
      "2027-01-02-fixture-plan",
    );

    assert.equal(clockReads, 1);
    assert.equal(result.completedAt, "2027-01-02T00:00:00.125Z");
    assert.equal(result.archiveName, "2027-01-02-fixture-plan");
    assert.equal(result.destination, destination);
    assert.equal(result.mode, "normal");
    assert.equal(existsSync(source), false);
    assert.equal(existsSync(join(destination, "plan.md")), true);
    assert.equal(
      readFileSync(join(destination, "tasks.md"), "utf8"),
      `${COMPLETE_TASKS}\n## Completion\n\n` +
        "- Completed at: 2027-01-02T00:00:00.125Z\n" +
        "- Mode: normal\n",
    );

    const validated = validatePlanletStructure({
      directoryName: result.archiveName,
      location: "completed",
      planMarkdown: readFileSync(join(destination, "plan.md"), "utf8"),
      tasksMarkdown: readFileSync(join(destination, "tasks.md"), "utf8"),
    });
    assert.equal(validated.state, "completed");
    assert.equal(validated.completion?.completedAt, result.completedAt);
  });
});

test("incomplete override records remaining IDs and the approved reason", () => {
  withRepository(INCOMPLETE_TASKS, (root, source) => {
    const result = complete({
      repositoryRoot: root,
      slug: "fixture-plan",
      allowIncomplete: true,
      reason: "  Deployment work intentionally deferred  ",
      dependencies: {
        now: () => new Date("2026-07-22T23:59:59.999Z"),
      },
    });
    const tasks = readFileSync(join(result.destination, "tasks.md"), "utf8");

    assert.equal(result.mode, "incomplete override");
    assert.deepEqual(result.remainingTaskIds, ["T2", "T4"]);
    assert.equal(existsSync(source), false);
    assert.match(
      tasks,
      /## Completion\n\n- Completed at: 2026-07-22T23:59:59\.999Z\n- Mode: incomplete override\n- Remaining tasks: T2, T4\n- Reason: Deployment work intentionally deferred\n$/,
    );
    assert.deepEqual(result.summary.warnings, [
      "Completed planlet contains an incomplete-task override",
    ]);
  });
});

test("normal completion refuses an empty draft without changing the source", () => {
  const draftTasks = "# Tasks: Fixture Plan\n";
  withRepository(draftTasks, (root, source) => {
    assert.throws(
      () => complete({ repositoryRoot: root, slug: "fixture-plan" }),
      (error) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "incomplete_tasks");
        assert.equal(error.details.state, "draft");
        return true;
      },
    );
    assert.equal(readFileSync(join(source, "tasks.md"), "utf8"), draftTasks);
  });
});

test("normal completion refuses incomplete tasks without changing the source", () => {
  withRepository(INCOMPLETE_TASKS, (root, source) => {
    assert.throws(
      () => complete({ repositoryRoot: root, slug: "fixture-plan" }),
      (error) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "incomplete_tasks");
        assert.deepEqual(error.details.remaining, ["T2", "T4"]);
        return true;
      },
    );
    assert.equal(
      readFileSync(join(source, "tasks.md"), "utf8"),
      INCOMPLETE_TASKS,
    );
  });
});

test("incomplete override rejects invalid reasons with a structured error", () => {
  for (const reason of [undefined, "", "   ", "first line\nsecond line"]) {
    withRepository(INCOMPLETE_TASKS, (root, source) => {
      assert.throws(
        () =>
          complete({
            repositoryRoot: root,
            slug: "fixture-plan",
            allowIncomplete: true,
            ...(reason === undefined ? {} : { reason }),
          }),
        (error) => {
          assert.ok(error instanceof PlanletError);
          assert.equal(error.code, "incomplete_tasks");
          assert.equal(error.details.reasonRequired, true);
          return true;
        },
      );
      assert.equal(
        readFileSync(join(source, "tasks.md"), "utf8"),
        INCOMPLETE_TASKS,
      );
    });
  }
});

test("completion rejects an internal symlink without moving its target", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    const target = join(root, "internal-target");
    rmSync(source, { recursive: true });
    mkdirSync(target);
    writeFileSync(join(target, "plan.md"), "# Fixture Plan\n");
    writeFileSync(join(target, "tasks.md"), COMPLETE_TASKS);
    symlinkSync(target, source, "dir");

    assert.throws(
      () => complete({ repositoryRoot: root, slug: "fixture-plan" }),
      (error) => error instanceof PlanletError && error.code === "unsafe_path",
    );
    assert.equal(existsSync(source), true);
    assert.equal(
      readFileSync(join(target, "tasks.md"), "utf8"),
      COMPLETE_TASKS,
    );
    assert.equal(existsSync(join(root, "plans", "completed")), false);
  });
});

test("completion refuses destination and logical-slug collisions without touching the source", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    mkdirSync(join(root, "plans", "completed", "2026-07-22-fixture-plan"), {
      recursive: true,
    });
    assert.throws(
      () =>
        complete({
          repositoryRoot: root,
          slug: "fixture-plan",
          dependencies: { now: () => new Date("2026-07-22T12:00:00Z") },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "archive_collision",
    );
    assert.equal(
      readFileSync(join(source, "tasks.md"), "utf8"),
      COMPLETE_TASKS,
    );
  });

  withRepository(COMPLETE_TASKS, (root, source) => {
    mkdirSync(join(root, "plans", "completed", "2025-01-01-fixture-plan"), {
      recursive: true,
    });
    assert.throws(
      () =>
        complete({
          repositoryRoot: root,
          slug: "fixture-plan",
          dependencies: { now: () => new Date("2026-07-22T12:00:00Z") },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "completed_plan_exists",
    );
    assert.equal(
      readFileSync(join(source, "tasks.md"), "utf8"),
      COMPLETE_TASKS,
    );
  });
});

test("a movement failure rolls back the audit so completion can be retried", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    assert.throws(
      () =>
        complete({
          repositoryRoot: root,
          slug: "fixture-plan",
          dependencies: {
            now: () => new Date("2026-07-22T12:00:00Z"),
            moveDirectory: () => {
              throw new Error("simulated move failure");
            },
          },
        }),
      (error) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "write_conflict");
        assert.equal(error.details.auditRecorded, false);
        assert.equal(error.details.auditRolledBack, true);
        return true;
      },
    );

    assert.equal(readFileSync(join(source, "plan.md"), "utf8"), PLAN);
    assert.equal(
      readFileSync(join(source, "tasks.md"), "utf8"),
      COMPLETE_TASKS,
    );

    const retried = complete({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: { now: () => new Date("2026-07-22T12:00:00Z") },
    });
    assert.equal(existsSync(retried.destination), true);
  });
});

test("completion resumes a valid audit left by process interruption", () => {
  const interrupted =
    `${COMPLETE_TASKS}\n## Completion\n\n` +
    "- Completed at: 2026-07-22T12:00:00.000Z\n" +
    "- Mode: normal\n";
  withRepository(interrupted, (root, source) => {
    let clockReads = 0;
    const result = complete({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: {
        now: () => {
          clockReads += 1;
          return new Date("2030-01-01T00:00:00Z");
        },
      },
    });

    assert.equal(clockReads, 0);
    assert.equal(result.archiveName, "2026-07-22-fixture-plan");
    assert.equal(result.completedAt, "2026-07-22T12:00:00.000Z");
    assert.equal(existsSync(source), false);
    assert.equal(
      readFileSync(join(result.destination, "tasks.md"), "utf8"),
      interrupted,
    );
  });
});

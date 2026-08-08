import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

import { completePlanlet } from "../../src/core/plan/planlet-completion.js";
import { validatePlanletStructure } from "../../src/core/plan/validation.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

const PLAN =
  "# Fixture Plan\n\n## Summary\nFixture.\n\n## Scope\nFixture.\n\n## Approach\nFixture.\n\n## Acceptance Criteria\n- Works.\n\n## Verification\nTests.\n";

function withRepository(
  tasksMarkdown: string,
  run: (root: string, source: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-completion-"));
  const source = join(root, "plans", "fixture-plan");
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "plan.md"), PLAN);
  writeFileSync(join(source, "tasks.md"), tasksMarkdown);
  try {
    run(root, source);
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

const COMPLETE_TASKS =
  "# Tasks: Fixture Plan\n\n- [x] T1 First task\n- [x] T2 Second task\n";
const INCOMPLETE_TASKS =
  "# Tasks: Fixture Plan\n\n- [x] T1 First task\n- [ ] T2 Second task\n- [ ] T4 Fourth task\n";

test("normal completion uses one UTC instant for its audit and archive date", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    let clockReads = 0;
    const result = completePlanlet({
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
    commitAll(root, "base");
    const result = completePlanlet({
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

const EVIDENCE =
  "\n## Verification Evidence\n\n" +
  "- Published `example-tool` 1.4.0; that version can never be republished.\n" +
  "  Tarball digest `sha512-3Qk1n0Ye`.\n";

for (const [mode, tasksMarkdown, options] of [
  ["normal", `${COMPLETE_TASKS}${EVIDENCE}`, {}],
  [
    "incomplete override",
    `${INCOMPLETE_TASKS}${EVIDENCE}`,
    { allowIncomplete: true, reason: "External gates pending" },
  ],
] as const) {
  test(`a free-form evidence section survives ${mode} completion unchanged`, () => {
    withRepository(tasksMarkdown, (root) => {
      const result = completePlanlet({
        repositoryRoot: root,
        slug: "fixture-plan",
        ...options,
        dependencies: { now: () => new Date("2026-07-31T10:00:00Z") },
      });
      const archived = readFileSync(
        join(result.destination, "tasks.md"),
        "utf8",
      );

      assert.equal(result.mode, mode);
      assert.ok(archived.startsWith(tasksMarkdown));
      assert.match(archived, /## Verification Evidence\n/);
      assert.match(
        archived,
        /## Verification Evidence[\s\S]*## Completion\n\n- Completed at: /,
      );

      const validated = validatePlanletStructure({
        directoryName: result.archiveName,
        location: "completed",
        planMarkdown: readFileSync(join(result.destination, "plan.md"), "utf8"),
        tasksMarkdown: archived,
      });
      assert.equal(validated.state, "completed");
      assert.deepEqual(
        validated.tasks.map((task) => task.id),
        mode === "normal" ? ["T1", "T2"] : ["T1", "T2", "T4"],
      );
      assert.equal(validated.completion?.mode, mode);
    });
  });
}

test("normal completion refuses an empty draft without changing the source", () => {
  const draftTasks = "# Tasks: Fixture Plan\n";
  withRepository(draftTasks, (root, source) => {
    assert.throws(
      () => completePlanlet({ repositoryRoot: root, slug: "fixture-plan" }),
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
      () => completePlanlet({ repositoryRoot: root, slug: "fixture-plan" }),
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
          completePlanlet({
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
      () => completePlanlet({ repositoryRoot: root, slug: "fixture-plan" }),
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
        completePlanlet({
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
        completePlanlet({
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

test("a movement failure keeps the audit so completion can resume", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    assert.throws(
      () =>
        completePlanlet({
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
        assert.equal(error.details.auditRecorded, true);
        assert.equal(error.details.auditRolledBack, false);
        return true;
      },
    );

    assert.equal(readFileSync(join(source, "plan.md"), "utf8"), PLAN);
    assert.match(
      readFileSync(join(source, "tasks.md"), "utf8"),
      /## Completion[\s\S]*Mode: normal/,
    );

    const retried = completePlanlet({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: { now: () => new Date("2030-01-01T00:00:00Z") },
    });
    assert.equal(retried.archiveName, "2026-07-22-fixture-plan");
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
    const result = completePlanlet({
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

test("completion stages the moved planlet and git reports the rename", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    commitAll(root, "base");
    writeFileSync(join(root, "other.txt"), "keep unstaged\n");

    const result = completePlanlet({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: { now: () => new Date("2027-01-02T00:00:00.125Z") },
    });

    assert.equal(existsSync(source), false);
    assert.equal(existsSync(result.destination), true);
    assert.deepEqual(porcelain(root).sort(), [
      "?? other.txt",
      "A  plans/completed/2027-01-02-fixture-plan/tasks.md",
      "D  plans/fixture-plan/tasks.md",
      "R  plans/fixture-plan/plan.md -> plans/completed/2027-01-02-fixture-plan/plan.md",
    ]);
  });
});

test("completion with stage disabled leaves the archived planlet unstaged", () => {
  withRepository(COMPLETE_TASKS, (root, source) => {
    commitAll(root, "base");

    const result = completePlanlet({
      repositoryRoot: root,
      slug: "fixture-plan",
      stage: false,
      dependencies: { now: () => new Date("2027-01-02T00:00:00.125Z") },
    });

    assert.equal(existsSync(source), false);
    assert.equal(existsSync(result.destination), true);
    assert.deepEqual(porcelain(root).sort(), [
      " D plans/fixture-plan/plan.md",
      " D plans/fixture-plan/tasks.md",
      "?? plans/completed/",
    ]);
  });
});

test("completion makes no git call in a non-git root", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-completion-nongit-"));
  const source = join(root, "plans", "fixture-plan");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "plan.md"), PLAN);
  writeFileSync(join(source, "tasks.md"), COMPLETE_TASKS);
  try {
    const result = completePlanlet({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: { now: () => new Date("2027-01-02T00:00:00.125Z") },
    });

    assert.equal(existsSync(result.destination), true);
    assert.equal(
      result.summary.warnings.some((warning) =>
        warning.startsWith("Could not stage"),
      ),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a completion git failure becomes a warning and completion still succeeds", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-completion-gitfail-"));
  const source = join(root, "plans", "fixture-plan");
  writeFileSync(join(root, ".git"), "gitdir: /nonexistent\n");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "plan.md"), PLAN);
  writeFileSync(join(source, "tasks.md"), COMPLETE_TASKS);
  try {
    const result = completePlanlet({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: { now: () => new Date("2027-01-02T00:00:00.125Z") },
    });

    assert.equal(existsSync(result.destination), true);
    assert.equal(
      result.summary.warnings.some((warning) =>
        warning.startsWith("Could not stage completed planlet"),
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

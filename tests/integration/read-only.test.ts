import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getPlanletStatus,
  getPlanletTasks,
  listPlanlets,
  showPlanlet,
  validatePlanlets,
} from "../../src/commands/read-only.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withRepository(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-read-only-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "plans"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePlanlet(
  root: string,
  directoryName: string,
  planMarkdown: string,
  tasksMarkdown: string,
  completed = false,
): void {
  const directory = completed
    ? join(root, "plans", "completed", directoryName)
    : join(root, "plans", directoryName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "plan.md"), planMarkdown);
  writeFileSync(join(directory, "tasks.md"), tasksMarkdown);
}

const PLAN = "# Valid Plan\n\n## Summary\nA fixture.\n";
const ACTIVE_TASKS =
  "# Tasks: Valid Plan\n\n- [x] T1 Done\n- [ ] T2 Remaining\n";
const COMPLETED_TASKS =
  "# Tasks: Old Plan\n\n- [x] T1 Done\n\n## Completion\n\n- Completed at: 2026-07-22T12:34:56Z\n- Mode: normal\n";

test("list and validate report explicit empty active repositories", () => {
  withRepository((root) => {
    assert.deepEqual(listPlanlets({ repositoryRoot: root }), []);
    assert.deepEqual(validatePlanlets({ repositoryRoot: root }), {
      valid: true,
      checked: 0,
      entries: [],
    });
  });
});

test("list covers active lifecycle states and state filtering", () => {
  withRepository((root) => {
    writePlanlet(root, "draft-plan", "# Draft Plan\n", "# Tasks: Draft Plan\n");
    writePlanlet(
      root,
      "planned-plan",
      "# Planned Plan\n",
      "# Tasks: Planned Plan\n\n- [ ] T1 Start\n",
    );
    writePlanlet(root, "valid-plan", PLAN, ACTIVE_TASKS);
    writePlanlet(
      root,
      "ready-plan",
      "# Ready Plan\n",
      "# Tasks: Ready Plan\n\n- [x] T1 Done\n",
    );

    assert.deepEqual(
      listPlanlets({ repositoryRoot: root }).map(({ slug, state }) => ({
        slug,
        state,
      })),
      [
        { slug: "draft-plan", state: "draft" },
        { slug: "planned-plan", state: "planned" },
        { slug: "ready-plan", state: "ready_to_complete" },
        { slug: "valid-plan", state: "in_progress" },
      ],
    );
    assert.deepEqual(
      listPlanlets({ repositoryRoot: root, state: "in_progress" }).map(
        (summary) => summary.slug,
      ),
      ["valid-plan"],
    );
  });
});

test("--completed includes valid completed archives and supports completed filtering", () => {
  withRepository((root) => {
    writePlanlet(root, "valid-plan", PLAN, ACTIVE_TASKS);
    writePlanlet(
      root,
      "2026-07-22-old-plan",
      "# Old Plan\n",
      COMPLETED_TASKS,
      true,
    );

    assert.deepEqual(
      listPlanlets({ repositoryRoot: root }).map((summary) => summary.slug),
      ["valid-plan"],
    );
    const completed = listPlanlets({
      repositoryRoot: root,
      completed: true,
      state: "completed",
    });
    assert.equal(completed.length, 1);
    assert.deepEqual(completed[0], {
      slug: "old-plan",
      archiveName: "2026-07-22-old-plan",
      completedAt: "2026-07-22T12:34:56Z",
      title: "Old Plan",
      state: "completed",
      completedTasks: 1,
      totalTasks: 1,
      path: join(
        realpathSync(root),
        "plans",
        "completed",
        "2026-07-22-old-plan",
      ),
      warnings: [],
    });
  });
});

test("show, status, and tasks expose valid active and completed planlets", () => {
  withRepository((root) => {
    writePlanlet(root, "valid-plan", PLAN, ACTIVE_TASKS);
    writePlanlet(
      root,
      "2026-07-22-old-plan",
      "# Old Plan\n",
      COMPLETED_TASKS,
      true,
    );

    assert.equal(
      showPlanlet({ repositoryRoot: root, slug: "valid-plan" }).part,
      "summary",
    );
    assert.deepEqual(
      showPlanlet({ repositoryRoot: root, slug: "valid-plan", part: "plan" }),
      { slug: "valid-plan", part: "plan", content: PLAN, warnings: [] },
    );
    assert.deepEqual(
      showPlanlet({ repositoryRoot: root, slug: "valid-plan", part: "tasks" }),
      {
        slug: "valid-plan",
        part: "tasks",
        content: ACTIVE_TASKS,
        warnings: [],
      },
    );
    assert.equal(
      getPlanletStatus({ repositoryRoot: root, slug: "valid-plan" }).state,
      "in_progress",
    );
    assert.equal(
      getPlanletStatus({ repositoryRoot: root, slug: "old-plan" }).state,
      "completed",
    );

    const all = getPlanletTasks({ repositoryRoot: root, slug: "valid-plan" });
    assert.deepEqual(
      all.tasks.map((task) => task.id),
      ["T1", "T2"],
    );
    assert.deepEqual(
      getPlanletTasks({
        repositoryRoot: root,
        slug: "valid-plan",
        remaining: true,
      }).tasks.map((task) => task.id),
      ["T2"],
    );
    assert.deepEqual(
      getPlanletTasks({
        repositoryRoot: root,
        slug: "valid-plan",
        completed: true,
      }).tasks.map((task) => task.id),
      ["T1"],
    );
    assert.deepEqual(
      { completedTasks: all.completedTasks, totalTasks: all.totalTasks },
      { completedTasks: 1, totalTasks: 2 },
    );
  });
});

test("invalid planlets are listable and validate reports their structural error", () => {
  withRepository((root) => {
    writePlanlet(
      root,
      "broken-plan",
      "Not an H1\n",
      "# Tasks\n\n- [?] T1 Broken\n",
    );
    writePlanlet(root, "valid-plan", PLAN, ACTIVE_TASKS);

    const invalid = listPlanlets({ repositoryRoot: root, state: "invalid" });
    assert.deepEqual(
      invalid.map((summary) => summary.slug),
      ["broken-plan"],
    );
    assert.equal(invalid[0]?.state, "invalid");

    const report = validatePlanlets({ repositoryRoot: root });
    assert.equal(report.valid, false);
    assert.equal(report.checked, 2);
    assert.equal(report.entries[0]?.slug, "broken-plan");
    assert.equal(report.entries[0]?.valid, false);
    assert.equal(report.entries[0]?.error?.code, "invalid_plan");
    assert.equal(report.entries[1]?.valid, true);

    assert.throws(
      () => showPlanlet({ repositoryRoot: root, slug: "broken-plan" }),
      (error) => error instanceof PlanletError && error.code === "invalid_plan",
    );
  });
});

test("validate targets one logical slug or all active and completed storage", () => {
  withRepository((root) => {
    writePlanlet(root, "valid-plan", PLAN, ACTIVE_TASKS);
    writePlanlet(
      root,
      "2026-07-22-old-plan",
      "# Old Plan\n",
      COMPLETED_TASKS,
      true,
    );
    writePlanlet(
      root,
      "not-an-archive",
      "# Broken Archive\n",
      "# Tasks\n",
      true,
    );

    const targeted = validatePlanlets({
      repositoryRoot: root,
      slug: "old-plan",
    });
    assert.equal(targeted.valid, true);
    assert.deepEqual(
      targeted.entries.map((entry) => entry.slug),
      ["old-plan"],
    );

    const activeOnly = validatePlanlets({ repositoryRoot: root });
    assert.deepEqual(
      activeOnly.entries.map((entry) => entry.slug),
      ["valid-plan"],
    );

    const all = validatePlanlets({ repositoryRoot: root, all: true });
    assert.equal(all.valid, false);
    assert.deepEqual(
      all.entries.map((entry) => entry.slug),
      ["valid-plan", "old-plan", "not-an-archive"],
    );
    assert.equal(all.entries[2]?.error?.code, "invalid_plan");
  });
});

test("--all validation rejects duplicate logical slugs across active and completed storage", () => {
  withRepository((root) => {
    writePlanlet(root, "shared-plan", PLAN, ACTIVE_TASKS);
    writePlanlet(
      root,
      "2026-07-21-shared-plan",
      "# Shared Plan\n",
      COMPLETED_TASKS.replaceAll("2026-07-22", "2026-07-21"),
      true,
    );
    writePlanlet(
      root,
      "2026-07-22-shared-plan",
      "# Shared Plan\n",
      COMPLETED_TASKS,
      true,
    );

    const report = validatePlanlets({ repositoryRoot: root, all: true });
    const conflictPaths = [
      join(realpathSync(root), "plans", "shared-plan"),
      join(realpathSync(root), "plans", "completed", "2026-07-21-shared-plan"),
      join(realpathSync(root), "plans", "completed", "2026-07-22-shared-plan"),
    ];

    assert.equal(report.valid, false);
    assert.equal(report.checked, 3);
    assert.deepEqual(
      report.entries.map((entry) => ({
        slug: entry.slug,
        valid: entry.valid,
        state: entry.summary.state,
        code: entry.error?.code,
        paths: entry.error?.details.paths,
      })),
      conflictPaths.map(() => ({
        slug: "shared-plan",
        valid: false,
        state: "invalid",
        code: "invalid_plan",
        paths: conflictPaths,
      })),
    );
  });
});

test("read-only operations reject missing, ambiguous, and conflicting filters", () => {
  withRepository((root) => {
    assert.throws(
      () => getPlanletStatus({ repositoryRoot: root, slug: "missing-plan" }),
      (error) =>
        error instanceof PlanletError && error.code === "plan_not_found",
    );
    assert.throws(
      () =>
        getPlanletTasks({
          repositoryRoot: root,
          slug: "missing-plan",
          remaining: true,
          completed: true,
        }),
      TypeError,
    );
    assert.throws(
      () =>
        validatePlanlets({ repositoryRoot: root, slug: "one-plan", all: true }),
      TypeError,
    );
  });
});

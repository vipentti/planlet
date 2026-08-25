import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPlanlet } from "../../src/core/plan/creation.js";
import { completePlanlet } from "../../src/core/plan/planlet-completion.js";
import {
  getPlanletStatus,
  getPlanletTasks,
  listPlanlets,
  showPlanlet,
  validatePlanlets,
} from "../../src/core/plan/read-only.js";
import {
  isCreatableSlug,
  isValidSlug,
  parseArchiveName,
} from "../../src/core/plan/slugs.js";
import { updateTask } from "../../src/core/plan/task-update.js";
import { validatePlanletStructure } from "../../src/core/plan/validation.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

const LEGACY_SLUG = "2026-08-25-my-plan";
const LEGACY_ARCHIVE = "2026-09-01-2026-08-25-my-plan";

const PLAN =
  "# Legacy Plan\n\n## Summary\nLegacy.\n\n## Scope\nLegacy.\n\n## Approach\nLegacy.\n\n## Acceptance Criteria\n- Works.\n\n## Verification\nTests.\n";
const ACTIVE_TASKS =
  "# Tasks: Legacy Plan\n\n- [x] T1 Done\n- [ ] T2 Remaining\n";
const COMPLETED_TASKS =
  "# Tasks: Legacy Plan\n\n- [x] T1 Done\n\n## Completion\n\n- Completed at: 2026-09-01T12:00:00.000Z\n- Mode: normal\n";

function withRepository(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-legacy-date-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeLegacyActive(root: string, tasks = ACTIVE_TASKS): string {
  const dir = join(root, "plans", LEGACY_SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.md"), PLAN);
  writeFileSync(join(dir, "tasks.md"), tasks);
  return dir;
}

function writeLegacyCompleted(root: string): string {
  const dir = join(root, "plans", "completed", LEGACY_ARCHIVE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.md"), PLAN);
  writeFileSync(join(dir, "tasks.md"), COMPLETED_TASKS);
  return dir;
}

test("legacy date-prefixed active planlets remain readable and validatable while create rejects them", () => {
  withRepository((root) => {
    writeLegacyActive(root);

    // Persistent slug syntax stays valid; creation policy rejects.
    assert.equal(isValidSlug(LEGACY_SLUG), true);
    assert.equal(isCreatableSlug(LEGACY_SLUG), false);
    assert.throws(
      () => createPlanlet({ repositoryRoot: root, slug: LEGACY_SLUG }),
      (error) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "invalid_slug");
        assert.match(
          error.next ?? "",
          /must not start with a date.*YYYY-MM-DD-.*reserved for archived plans.*plans\/completed\//,
        );
        return true;
      },
    );

    const validated = validatePlanletStructure({
      directoryName: LEGACY_SLUG,
      location: "active",
      planMarkdown: PLAN,
      tasksMarkdown: ACTIVE_TASKS,
    });
    assert.equal(validated.slug, LEGACY_SLUG);
    assert.equal(validated.state, "in_progress");

    const listed = listPlanlets({ repositoryRoot: root });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.slug, LEGACY_SLUG);
    assert.equal(listed[0]!.state, "in_progress");

    assert.equal(
      getPlanletStatus({ repositoryRoot: root, slug: LEGACY_SLUG }).state,
      "in_progress",
    );
    assert.equal(
      showPlanlet({ repositoryRoot: root, slug: LEGACY_SLUG, part: "plan" })
        .content,
      PLAN,
    );
    assert.deepEqual(
      getPlanletTasks({ repositoryRoot: root, slug: LEGACY_SLUG }).tasks.map(
        (task) => task.id,
      ),
      ["T1", "T2"],
    );

    const report = validatePlanlets({ repositoryRoot: root });
    assert.equal(report.valid, true);
    assert.equal(report.entries[0]!.slug, LEGACY_SLUG);
    assert.equal(report.entries[0]!.valid, true);
  });
});

test("legacy date-prefixed active planlets remain task-updatable and completable", () => {
  withRepository((root) => {
    writeLegacyActive(root, ACTIVE_TASKS);

    const updated = updateTask({
      operation: "check",
      repositoryRoot: root,
      slug: LEGACY_SLUG,
      taskId: "T2",
    });
    assert.equal(updated.changed, true);
    assert.equal(updated.state, "ready_to_complete");
    assert.match(
      readFileSync(join(root, "plans", LEGACY_SLUG, "tasks.md"), "utf8"),
      /- \[x\] T2 Remaining/,
    );

    const result = completePlanlet({
      repositoryRoot: root,
      slug: LEGACY_SLUG,
      dependencies: { now: () => new Date("2026-09-01T12:00:00.000Z") },
    });
    assert.equal(result.slug, LEGACY_SLUG);
    assert.equal(result.archiveName, LEGACY_ARCHIVE);
    assert.equal(parseArchiveName(result.archiveName)?.slug, LEGACY_SLUG);
    assert.equal(existsSync(join(root, "plans", LEGACY_SLUG)), false);
    assert.equal(existsSync(result.destination), true);
  });
});

test("legacy completed planlet with date-prefixed logical slug remains readable", () => {
  withRepository((root) => {
    writeLegacyCompleted(root);

    assert.deepEqual(parseArchiveName(LEGACY_ARCHIVE), {
      archiveName: LEGACY_ARCHIVE,
      archiveDate: "2026-09-01",
      slug: LEGACY_SLUG,
    });

    const validated = validatePlanletStructure({
      directoryName: LEGACY_ARCHIVE,
      location: "completed",
      planMarkdown: readFileSync(
        join(root, "plans", "completed", LEGACY_ARCHIVE, "plan.md"),
        "utf8",
      ),
      tasksMarkdown: readFileSync(
        join(root, "plans", "completed", LEGACY_ARCHIVE, "tasks.md"),
        "utf8",
      ),
    });
    assert.equal(validated.slug, LEGACY_SLUG);
    assert.equal(validated.state, "completed");

    const completed = listPlanlets({
      repositoryRoot: root,
      completed: true,
      state: "completed",
    });
    assert.equal(completed.length, 1);
    assert.equal(completed[0]!.slug, LEGACY_SLUG);
    assert.equal(completed[0]!.archiveName, LEGACY_ARCHIVE);

    assert.equal(
      getPlanletStatus({ repositoryRoot: root, slug: LEGACY_SLUG }).state,
      "completed",
    );
    assert.equal(
      showPlanlet({ repositoryRoot: root, slug: LEGACY_SLUG }).part,
      "summary",
    );

    const report = validatePlanlets({ repositoryRoot: root, all: true });
    assert.equal(report.valid, true);
    assert.deepEqual(
      report.entries.map((entry) => entry.slug),
      [LEGACY_SLUG],
    );
  });
});

test("create still rejects date-prefixed slugs including invalid calendar prefix while allowing non-prefix dates", () => {
  withRepository((root) => {
    for (const slug of ["2026-08-25-my-plan", "2026-99-99-foo"]) {
      assert.throws(
        () => createPlanlet({ repositoryRoot: root, slug }),
        (error) =>
          error instanceof PlanletError && error.code === "invalid_slug",
      );
    }

    const ok = createPlanlet({ repositoryRoot: root, slug: "my-2026-plan" });
    assert.equal(ok.slug, "my-2026-plan");
  });
});

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
import { parseArchiveName } from "../../src/core/plan/slugs.js";
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

test("legacy active date-prefixed slug can be updated and completed", () => {
  withRepository((root) => {
    const dir = join(root, "plans", LEGACY_SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.md"), PLAN);
    writeFileSync(join(dir, "tasks.md"), ACTIVE_TASKS);

    const updated = updateTask({
      operation: "check",
      repositoryRoot: root,
      slug: LEGACY_SLUG,
      taskId: "T2",
    });
    assert.equal(updated.state, "ready_to_complete");

    const result = completePlanlet({
      repositoryRoot: root,
      slug: LEGACY_SLUG,
      dependencies: { now: () => new Date("2026-09-01T12:00:00.000Z") },
    });
    assert.equal(result.archiveName, LEGACY_ARCHIVE);
    assert.equal(parseArchiveName(result.archiveName)?.slug, LEGACY_SLUG);
    assert.equal(existsSync(result.destination), true);
  });
});

test("legacy archive with date-prefixed logical slug remains readable", () => {
  withRepository((root) => {
    const dir = join(root, "plans", "completed", LEGACY_ARCHIVE);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.md"), PLAN);
    writeFileSync(join(dir, "tasks.md"), COMPLETED_TASKS);

    assert.deepEqual(parseArchiveName(LEGACY_ARCHIVE), {
      archiveName: LEGACY_ARCHIVE,
      archiveDate: "2026-09-01",
      slug: LEGACY_SLUG,
    });

    const validated = validatePlanletStructure({
      directoryName: LEGACY_ARCHIVE,
      location: "completed",
      planMarkdown: readFileSync(join(dir, "plan.md"), "utf8"),
      tasksMarkdown: readFileSync(join(dir, "tasks.md"), "utf8"),
    });
    assert.equal(validated.state, "completed");
    assert.equal(validated.slug, LEGACY_SLUG);
  });
});

test("creation rejects date-prefixed slugs", () => {
  withRepository((root) => {
    for (const slug of ["2026-08-25-my-plan", "2026-99-99-foo"]) {
      assert.throws(
        () => createPlanlet({ repositoryRoot: root, slug }),
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
    }
  });
});

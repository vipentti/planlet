import assert from "node:assert/strict";
import test from "node:test";

import {
  extractTouchedSlugs,
  selectCompletionViolations,
} from "../../src/core/check-completion.js";
import type { PlanSummary } from "../../src/core/plan/models.js";
import type { ValidationResult } from "../../src/core/plan/read-only.js";

function summary(
  slug: string,
  path: string,
  state: PlanSummary["state"],
): PlanSummary {
  return {
    slug,
    state,
    completedTasks: state === "ready_to_complete" ? 1 : 0,
    totalTasks: 1,
    path,
    warnings: [],
  };
}

test("extractTouchedSlugs ignores completed, invalid, and direct plans paths", () => {
  assert.deepEqual(
    extractTouchedSlugs([
      "plans/ready-plan/plan.md",
      "plans/ready-plan/file with spaces.md",
      "plans/completed/2028-01-01-old-plan/tasks.md",
      "plans/UPPER/tasks.md",
      "plans/123/tasks.md",
      "plans/README.md",
      "other/ready-plan/tasks.md",
    ]),
    ["ready-plan"],
  );
});

test("selectCompletionViolations excludes collided active planlets", () => {
  const unique = summary(
    "unique-ready",
    "/repo/plans/unique-ready",
    "ready_to_complete",
  );
  const collided = summary(
    "collided-ready",
    "/repo/plans/collided-ready",
    "ready_to_complete",
  );
  const inProgress = summary(
    "in-progress",
    "/repo/plans/in-progress",
    "in_progress",
  );
  const active = [unique, collided, inProgress];
  const validation: ValidationResult = {
    valid: false,
    checked: 4,
    entries: [
      { slug: unique.slug, path: unique.path, valid: true, summary: unique },
      {
        slug: collided.slug,
        path: collided.path,
        valid: false,
        summary: summary(collided.slug, collided.path, "invalid"),
      },
      {
        slug: collided.slug,
        path: "/repo/plans/completed/2028-01-01-collided-ready",
        valid: false,
        summary: summary(
          collided.slug,
          "/repo/plans/completed/2028-01-01-collided-ready",
          "invalid",
        ),
      },
      {
        slug: inProgress.slug,
        path: inProgress.path,
        valid: true,
        summary: inProgress,
      },
    ],
  };

  assert.deepEqual(
    selectCompletionViolations(
      ["collided-ready", "in-progress", "unique-ready"],
      active,
      validation,
    ),
    [{ slug: "unique-ready", next: "planlet complete unique-ready" }],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCompletionResult,
  extractCompletedSlugs,
  extractTouchedSlugs,
} from "../../src/core/check-completion.js";
import type { PlanSummary } from "../../src/core/plan/models.js";
import type { ValidationResult } from "../../src/core/plan/read-only.js";

function summary(
  slug: string,
  path: string,
  state: PlanSummary["state"],
  archiveName?: string,
  warnings: readonly string[] = [],
): PlanSummary {
  return {
    slug,
    ...(archiveName === undefined ? {} : { archiveName }),
    state,
    completedTasks: state === "ready_to_complete" ? 1 : 0,
    totalTasks: 1,
    path,
    warnings,
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

test("extractCompletedSlugs matches removed active and added archive families", () => {
  assert.deepEqual(
    extractCompletedSlugs([
      {
        status: "R065",
        paths: [
          "plans/finished-plan/tasks.md",
          "plans/completed/2028-01-01-finished-plan/tasks.md",
        ],
      },
      {
        status: "D",
        paths: ["plans/removed-plan/plan.md"],
      },
      {
        status: "A",
        paths: ["plans/completed/2028-01-01-removed-plan/plan.md"],
      },
      {
        status: "A",
        paths: ["plans/completed/2028-01-01-unrelated-plan/plan.md"],
      },
      {
        status: "R100",
        paths: [
          "plans/copied-plan/plan.md",
          "plans/completed/not-an-archive/plan.md",
        ],
      },
    ]),
    ["finished-plan", "removed-plan"],
  );
});

test("deriveCompletionResult uses one validation snapshot for active state and uniqueness", () => {
  const ready = summary(
    "unique-ready",
    "/repo/plans/unique-ready",
    "ready_to_complete",
    undefined,
    ["active warning"],
  );
  const collided = summary(
    "collided-ready",
    "/repo/plans/collided-ready",
    "invalid",
  );
  const inProgress = summary(
    "in-progress",
    "/repo/plans/in-progress",
    "in_progress",
  );
  const completed = summary(
    "completed-plan",
    "/repo/plans/completed/2028-01-01-completed-plan",
    "completed",
    "2028-01-01-completed-plan",
  );
  const validation: ValidationResult = {
    valid: false,
    checked: 5,
    entries: [
      { slug: ready.slug, path: ready.path, valid: true, summary: ready },
      {
        slug: collided.slug,
        path: collided.path,
        valid: false,
        summary: collided,
      },
      {
        slug: collided.slug,
        path: "/repo/plans/completed/2028-01-01-collided-ready",
        valid: false,
        summary: summary(
          collided.slug,
          "/repo/plans/completed/2028-01-01-collided-ready",
          "invalid",
          "2028-01-01-collided-ready",
        ),
      },
      {
        slug: inProgress.slug,
        path: inProgress.path,
        valid: true,
        summary: inProgress,
      },
      {
        slug: completed.slug,
        path: completed.path,
        valid: true,
        summary: completed,
      },
    ],
  };

  assert.deepEqual(
    deriveCompletionResult(
      "origin/main",
      ["collided-ready", "completed-plan", "in-progress", "unique-ready"],
      validation,
      ["completed-plan"],
    ),
    {
      ok: false,
      base: "origin/main",
      touched: ["collided-ready", "in-progress", "unique-ready"],
      completed: ["completed-plan"],
      violations: [
        { slug: "unique-ready", next: "planlet complete unique-ready" },
      ],
      warnings: ["active warning"],
    },
  );
});

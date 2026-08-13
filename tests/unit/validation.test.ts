import assert from "node:assert/strict";
import test from "node:test";

import { PlanletError } from "../../src/errors/planlet-error.js";
import { validatePlanletStructure } from "../../src/core/plan/validation.js";

test("active planlet validation accepts a narrow valid structure", () => {
  const validated = validatePlanletStructure({
    directoryName: "cli-core",
    location: "active",
    planMarkdown: "# CLI Core\n\n## Summary\nBuild it.\n",
    tasksMarkdown: `# Tasks: CLI Core

- [x] T1 First
- [ ] T2 Second
`,
  });

  assert.equal(validated.slug, "cli-core");
  assert.equal(validated.title, "CLI Core");
  assert.equal(validated.state, "in_progress");
  assert.equal(validated.completion, null);
});

test("completed validation requires matching audit data and archive date", () => {
  const validated = validatePlanletStructure({
    directoryName: "2026-07-22-cli-core",
    location: "completed",
    planMarkdown: "# CLI Core\n",
    tasksMarkdown: `# Tasks: CLI Core

- [x] T1 First

## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: normal
`,
  });

  assert.equal(validated.state, "completed");
  assert.deepEqual(validated.completion, {
    completedAt: "2026-07-22T12:34:56Z",
    mode: "normal",
    remainingTaskIds: [],
  });

  assert.throws(
    () =>
      validatePlanletStructure({
        directoryName: "2026-07-23-cli-core",
        location: "completed",
        planMarkdown: "# CLI Core\n",
        tasksMarkdown: `# Tasks

## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: normal
`,
      }),
    (error) => error instanceof PlanletError && error.code === "invalid_plan",
  );

  assert.throws(
    () =>
      validatePlanletStructure({
        directoryName: "2026-07-22-empty-archive",
        location: "completed",
        planMarkdown: "# Empty Archive\n",
        tasksMarkdown: `# Tasks

## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: normal
`,
      }),
    (error) =>
      error instanceof PlanletError &&
      error.code === "invalid_plan" &&
      error.message.includes("at least one recognized task"),
  );
});

test("validation warns about every missing recommended plan section", () => {
  const validated = validatePlanletStructure({
    directoryName: "cli-core",
    location: "active",
    planMarkdown: "# CLI Core\n\n## Summary\nBuild it.\n",
    tasksMarkdown: `# Tasks

- [ ] T1 Build it
`,
  });

  assert.deepEqual(validated.warnings, [
    "plan.md is missing recommended sections: Scope, Approach, Acceptance Criteria, Verification",
  ]);
});

test("incomplete overrides accept reordered remaining task IDs", () => {
  const validated = validatePlanletStructure({
    directoryName: "2026-07-22-cli-core",
    location: "completed",
    planMarkdown: "# CLI Core\n",
    tasksMarkdown: `# Tasks

- [ ] T2 Later
- [ ] T4 Also later
- [x] T3 Done

## Completion

- Completed at: 2026-07-22T12:34:56.000Z
- Mode: incomplete override
- Remaining tasks: T4, T2
- Reason: Deferred by approval
`,
  });

  assert.equal(validated.completion?.mode, "incomplete override");
});

test("active planlet carrying a completion record is flagged with a warning", () => {
  const validated = validatePlanletStructure({
    directoryName: "cli-core",
    location: "active",
    planMarkdown: "# CLI Core\n",
    tasksMarkdown: `# Tasks

- [x] T1 First

## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: normal
`,
  });

  assert.equal(validated.state, "ready_to_complete");
  assert.ok(
    validated.warnings.some((warning) =>
      warning.includes("Active planlet contains a completion record"),
    ),
  );
});

test("active incomplete overrides require recorded tasks to remain unchecked", () => {
  assert.throws(
    () =>
      validatePlanletStructure({
        directoryName: "cli-core",
        location: "active",
        planMarkdown: "# CLI Core\n",
        tasksMarkdown: `# Tasks

- [x] T1 Changed after audit

## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: incomplete override
- Remaining tasks: T1
- Reason: Interrupted archive
`,
      }),
    (error) =>
      error instanceof PlanletError &&
      error.code === "invalid_plan" &&
      error.message.includes("remaining tasks do not match"),
  );
});

test("completed normal mode with unchecked tasks is invalid_plan", () => {
  assert.throws(
    () =>
      validatePlanletStructure({
        directoryName: "2026-07-22-cli-core",
        location: "completed",
        planMarkdown: "# CLI Core\n",
        tasksMarkdown: `# Tasks: CLI Core

- [x] T1 First
- [ ] T2 Later

## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: normal
`,
      }),
    (error) =>
      error instanceof PlanletError &&
      error.code === "invalid_plan" &&
      error.message.includes("unchecked tasks without an override"),
  );
});

test("incomplete overrides require exact remaining task IDs and a reason", () => {
  const tasksMarkdown = `# Tasks

- [ ] T2 Later
- [x] T3 Done

## Completion

- Completed at: 2026-07-22T12:34:56.000Z
- Mode: incomplete override
- Remaining tasks: T2
- Reason: Deferred by approval
`;

  const validated = validatePlanletStructure({
    directoryName: "2026-07-22-cli-core",
    location: "completed",
    planMarkdown: "# CLI Core\n",
    tasksMarkdown,
  });
  assert.equal(validated.completion?.mode, "incomplete override");
  assert.deepEqual(validated.warnings, [
    "plan.md is missing recommended sections: Summary, Scope, Approach, Acceptance Criteria, Verification",
    "Completed planlet contains an incomplete-task override",
  ]);

  assert.throws(
    () =>
      validatePlanletStructure({
        directoryName: "2026-07-22-cli-core",
        location: "completed",
        planMarkdown: "# CLI Core\n",
        tasksMarkdown: tasksMarkdown.replace(
          "Remaining tasks: T2",
          "Remaining tasks: T9",
        ),
      }),
    (error) => error instanceof PlanletError && error.code === "invalid_plan",
  );
});

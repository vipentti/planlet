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

test("soft-wrapped indented continuation is consumed into description", () => {
  const validated = validatePlanletStructure({
    directoryName: "continuation-plan",
    location: "active",
    planMarkdown: "# Continuation Plan\n",
    tasksMarkdown: `# Tasks: Continuation Plan

- [ ] T1 First line
  indented continuation
`,
  });

  assert.equal(validated.tasks.length, 1);
  assert.equal(
    validated.tasks[0]?.description,
    "First line indented continuation",
  );
});

test("tab-indented continuation is consumed", () => {
  const validated = validatePlanletStructure({
    directoryName: "continuation-plan",
    location: "active",
    planMarkdown: "# Continuation Plan\n",
    tasksMarkdown: `# Tasks: Continuation Plan

- [ ] T1 First
	indented continuation
`,
  });

  assert.equal(validated.tasks.length, 1);
  assert.equal(validated.tasks[0]?.description, "First indented continuation");
});

test("multiple indented continuations are concatenated with single spaces", () => {
  const validated = validatePlanletStructure({
    directoryName: "continuation-plan",
    location: "active",
    planMarkdown: "# Continuation Plan\n",
    tasksMarkdown: `# Tasks: Continuation Plan

- [ ] T1 First
  second line
  third line
`,
  });

  assert.equal(validated.tasks.length, 1);
  assert.equal(validated.tasks[0]?.description, "First second line third line");
});

test("nested unordered list after task is consumed", () => {
  const validated = validatePlanletStructure({
    directoryName: "continuation-plan",
    location: "active",
    planMarkdown: "# Continuation Plan\n",
    tasksMarkdown: `# Tasks: Continuation Plan

- [ ] T1 Something with list
  - Acceptance detail
  - second item
`,
  });

  assert.equal(validated.tasks.length, 1);
  assert.equal(
    validated.tasks[0]?.description,
    "Something with list - Acceptance detail - second item",
  );
});

test("nested ordered list after task is consumed", () => {
  const validated = validatePlanletStructure({
    directoryName: "continuation-plan",
    location: "active",
    planMarkdown: "# Continuation Plan\n",
    tasksMarkdown: `# Tasks: Continuation Plan

- [ ] T1 Something with list
  1. Step 1
  2. Step 2
`,
  });

  assert.equal(validated.tasks.length, 1);
  assert.equal(
    validated.tasks[0]?.description,
    "Something with list 1. Step 1 2. Step 2",
  );
});

test("conndeck prose continuation (6-space wrap) is consumed", () => {
  const validated = validatePlanletStructure({
    directoryName: "continuation-plan",
    location: "active",
    planMarkdown: "# Continuation Plan\n",
    tasksMarkdown: `# Tasks: Continuation Plan

- [ ] T1 This is a long task description that exceeds width
      and continues with six-space indent
`,
  });

  assert.equal(validated.tasks.length, 1);
  assert.equal(
    validated.tasks[0]?.description,
    "This is a long task description that exceeds width and continues with six-space indent",
  );
});

test("parser precedence preserves task-like line error without taskId", () => {
  assert.throws(
    () =>
      validatePlanletStructure({
        directoryName: "continuation-plan",
        location: "active",
        planMarkdown: "# Continuation Plan\n",
        tasksMarkdown: `# Tasks: Continuation Plan

- [ ] T1 First
  - [ ] T2 Nested
`,
      }),
    (error) =>
      error instanceof PlanletError &&
      error.code === "invalid_plan" &&
      error.details.line === 4 &&
      error.details.content === "  - [ ] T2 Nested" &&
      error.details.taskId === undefined,
  );
});

test("single-line active tasks remain valid", () => {
  const validated = validatePlanletStructure({
    directoryName: "single-line-plan",
    location: "active",
    planMarkdown: "# Single Line Plan\n",
    tasksMarkdown: `# Tasks: Single Line Plan

- [ ] T1 First
- [x] T2 Second
`,
  });

  assert.equal(validated.tasks.length, 2);

  const withSingleSpace = validatePlanletStructure({
    directoryName: "single-space-plan",
    location: "active",
    planMarkdown: "# Single Space Plan\n",
    tasksMarkdown: `# Tasks: Single Space Plan

- [ ] T1 First
 single space not continuation
`,
  });

  assert.equal(withSingleSpace.tasks.length, 1);
  assert.equal(withSingleSpace.tasks[0]?.description, "First");
});

test("ordinary Markdown outside tasks remains allowed when not adjacent", () => {
  const beforeFirst = validatePlanletStructure({
    directoryName: "prose-before-plan",
    location: "active",
    planMarkdown: "# Prose Before Plan\n",
    tasksMarkdown: `# Tasks: Prose Before Plan

Prose before first task.

- [ ] T1 First
`,
  });
  assert.equal(beforeFirst.tasks.length, 1);

  const blankSeparated = validatePlanletStructure({
    directoryName: "blank-separated-plan",
    location: "active",
    planMarkdown: "# Blank Separated Plan\n",
    tasksMarkdown: `# Tasks: Blank Separated Plan

- [ ] T1 First

  indented after blank line
`,
  });
  assert.equal(blankSeparated.tasks.length, 1);
  assert.equal(blankSeparated.tasks[0]?.description, "First");

  const headingAfter = validatePlanletStructure({
    directoryName: "heading-after-plan",
    location: "active",
    planMarkdown: "# Heading After Plan\n",
    tasksMarkdown: `# Tasks: Heading After Plan

- [ ] T1 First
## Heading
`,
  });
  assert.equal(headingAfter.tasks.length, 1);
  assert.equal(headingAfter.tasks[0]?.description, "First");

  const nextTask = validatePlanletStructure({
    directoryName: "next-task-plan",
    location: "active",
    planMarkdown: "# Next Task Plan\n",
    tasksMarkdown: `# Tasks: Next Task Plan

- [ ] T1 First
- [ ] T2 Second
`,
  });
  assert.equal(nextTask.tasks.length, 2);
  assert.equal(nextTask.tasks[0]?.description, "First");
  assert.equal(nextTask.tasks[1]?.description, "Second");
});

test("completed archives consume nested list as continuation", () => {
  const validated = validatePlanletStructure({
    directoryName: "2026-07-22-continuation-plan",
    location: "completed",
    planMarkdown: "# Continuation Plan\n",
    tasksMarkdown: `# Tasks: Continuation Plan

- [x] T1 First
  - Acceptance detail

## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: normal
`,
  });

  assert.equal(validated.state, "completed");
  assert.equal(validated.tasks.length, 1);
  assert.equal(validated.tasks[0]?.description, "First - Acceptance detail");
});

test("Prettier proseWrap always wrapped task is normalized", async () => {
  const prettier = await import("prettier");
  const long =
    "This is a very long task description that definitely exceeds the default print width of eighty characters and should be wrapped by Prettier with proseWrap always";
  const singleLine = `# Tasks: Fixture

- [ ] T1 ${long}
`;
  const wrapped = await (
    prettier as unknown as {
      format: (s: string, o: unknown) => Promise<string>;
    }
  ).format(singleLine, {
    parser: "markdown",
    proseWrap: "always",
    printWidth: 80,
  } as unknown as Record<string, unknown>);
  assert.match(wrapped, / {2,}\S/);
  const validated = validatePlanletStructure({
    directoryName: "prettier-plan",
    location: "active",
    planMarkdown: "# Prettier Plan\n",
    tasksMarkdown: wrapped,
  });
  assert.equal(validated.tasks.length, 1);
  assert.equal(validated.tasks[0]?.description, long);
});

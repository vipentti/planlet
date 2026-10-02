import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

import { decode } from "@toon-format/toon";

import { main, type CliRuntime } from "../../src/cli.js";
import { checkCompletion } from "../../src/core/check-completion.js";
import { completePlanlet } from "../../src/core/plan/planlet-completion.js";
import { createPlanlet } from "../../src/core/plan/creation.js";
import { updateTask } from "../../src/core/plan/task-update.js";
import { commitAll, withGitRoot } from "./git-fixtures.js";

const PLAN = `# Fixture Plan

## Summary
See [design](../../../README.md).

## Scope
Fixture.

## Approach
Fixture.

## Acceptance Criteria
- Works.

## Verification
Tests.
`;

const ARCHIVED_PLAN = `# Fixture Plan

## Summary
See [design](../../../../README.md).

## Scope
Fixture.

## Approach
Fixture.

## Acceptance Criteria
- Works.

## Verification
Tests.
`;

interface Capture {
  readonly stdout: string[];
  readonly stderr: string[];
}

async function invoke(
  root: string,
  arguments_: readonly string[],
): Promise<{ readonly exitCode: number; readonly capture: Capture }> {
  const capture: Capture = { stdout: [], stderr: [] };
  const runtime: CliRuntime = {
    cwd: root,
    stdout: (value) => capture.stdout.push(value),
    stderr: (value) => capture.stderr.push(value),
    clock: () => new Date("2028-03-04T05:06:07Z"),
  };
  return {
    exitCode: await main(["--root", root, ...arguments_], runtime),
    capture,
  };
}

function errorCode(capture: Capture): string {
  return (
    decode(capture.stderr.join("").trimEnd()) as {
      error: { code: string };
    }
  ).error.code;
}

function writeConfig(root: string, plansDir: string): void {
  writeFileSync(
    join(root, ".planlet.json"),
    `${JSON.stringify({ plansDir }, null, 2)}\n`,
  );
}

function makeGitBase(root: string): void {
  writeFileSync(join(root, "README.md"), "base\n");
  commitAll(root, "base");
  const branch = spawnSync("git", ["branch", "base"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(branch.status, 0, branch.stderr);
}

test("docs/plans create, task check, complete, and link rewrite", async () => {
  await withGitRoot(async (root) => {
    writeConfig(root, "docs/plans");
    writeFileSync(join(root, "README.md"), "root\n");
    const summary = createPlanlet({
      repositoryRoot: root,
      slug: "fixture-plan",
      title: "Fixture Plan",
    });
    assert.equal(summary.path, join(root, "docs", "plans", "fixture-plan"));

    writeFileSync(join(summary.path, "plan.md"), PLAN);
    writeFileSync(
      join(summary.path, "tasks.md"),
      "# Tasks: Fixture Plan\n\n- [ ] T1 Ship\n",
    );

    const checked = updateTask({
      repositoryRoot: root,
      slug: "fixture-plan",
      taskId: "T1",
      operation: "check",
    });
    assert.equal(checked.state, "ready_to_complete");

    const completed = completePlanlet({
      repositoryRoot: root,
      slug: "fixture-plan",
      dependencies: { now: () => new Date("2028-03-04T05:06:07Z") },
    });
    assert.equal(
      completed.destination,
      join(root, "docs", "plans", "completed", "2028-03-04-fixture-plan"),
    );
    assert.equal(
      readFileSync(join(completed.destination, "plan.md"), "utf8"),
      ARCHIVED_PLAN,
    );
  });
});

test("missing configured directory is plans_not_initialized and the gate still returns ok", async () => {
  await withGitRoot(async (root) => {
    makeGitBase(root);
    writeConfig(root, "docs/plans");

    const listed = await invoke(root, ["list"]);
    assert.equal(listed.exitCode, 1);
    assert.equal(errorCode(listed.capture), "plans_not_initialized");

    const gate = checkCompletion({ repositoryRoot: root, base: "base" });
    assert.equal(gate.ok, true);
    assert.deepEqual(gate.touched, []);
    assert.deepEqual(gate.violations, []);
  });
});

test("leftover plans/ with a non-default plansDir fails the gate with plans_dir_conflict", async () => {
  await withGitRoot(async (root) => {
    makeGitBase(root);
    writeConfig(root, "docs/plans");
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    mkdirSync(join(root, "plans", "old-plan"), { recursive: true });
    writeFileSync(join(root, "plans", "old-plan", "plan.md"), "# Old\n");
    writeFileSync(
      join(root, "plans", "old-plan", "tasks.md"),
      "# Tasks: Old\n",
    );
    commitAll(root, "leftover");

    const result = await invoke(root, ["check-completion", "--base", "base"]);
    assert.equal(result.exitCode, 1);
    assert.equal(errorCode(result.capture), "plans_dir_conflict");
    assert.equal(result.capture.stdout.join(""), "");
  });
});

test("a present .planlet.yaml is a loud invalid_config error", async () => {
  await withGitRoot(async (root) => {
    makeGitBase(root);
    mkdirSync(join(root, "plans"));
    writeFileSync(join(root, ".planlet.yaml"), "plansDir: docs/plans\n");

    const result = await invoke(root, ["list"]);
    assert.equal(result.exitCode, 1);
    assert.equal(errorCode(result.capture), "invalid_config");
  });
});

test("check-completion extracts a two-segment prefix from git diffs", async () => {
  await withGitRoot(async (root) => {
    makeGitBase(root);
    writeConfig(root, "docs/plans");
    mkdirSync(join(root, "docs", "plans", "ready-plan"), { recursive: true });
    writeFileSync(
      join(root, "docs", "plans", "ready-plan", "plan.md"),
      "# Ready Plan\n",
    );
    writeFileSync(
      join(root, "docs", "plans", "ready-plan", "tasks.md"),
      "# Tasks\n\n- [x] T1 Done\n",
    );
    commitAll(root, "ready under docs/plans");

    const result = await invoke(root, ["check-completion", "--base", "base"]);
    assert.equal(result.exitCode, 4);
    assert.deepEqual(decode(result.capture.stdout.join("").trimEnd()), {
      ok: false,
      base: "base",
      touched: ["ready-plan"],
      completed: [],
      violations: [{ slug: "ready-plan", next: "planlet complete ready-plan" }],
    });
  });
});

test("a plansDir symlink component fails the gate with invalid_config", async () => {
  await withGitRoot(async (root) => {
    makeGitBase(root);
    mkdirSync(join(root, "store", "plans", "ready-plan"), { recursive: true });
    writeFileSync(
      join(root, "store", "plans", "ready-plan", "plan.md"),
      "# Ready Plan\n",
    );
    writeFileSync(
      join(root, "store", "plans", "ready-plan", "tasks.md"),
      "# Tasks\n\n- [x] T1 Done\n",
    );
    symlinkSync(join(root, "store"), join(root, "docs"));
    writeConfig(root, "docs/plans");
    commitAll(root, "symlinked plansDir");

    const result = await invoke(root, ["check-completion", "--base", "base"]);
    assert.equal(result.exitCode, 1);
    assert.equal(errorCode(result.capture), "invalid_config");
    assert.equal(result.capture.stdout.join(""), "");
  });
});

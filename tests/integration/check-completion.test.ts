import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

import { decode } from "@toon-format/toon";

import { main, type CliRuntime } from "../../src/cli.js";
import { commitAll, porcelain, withGitRoot } from "./git-fixtures.js";

interface Capture {
  readonly stdout: string[];
  readonly stderr: string[];
}

function writePlanlet(
  root: string,
  slug: string,
  tasks: string,
  completed = false,
): void {
  const directory = completed
    ? join(root, "plans", "completed", slug)
    : join(root, "plans", slug);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "plan.md"), `# ${slug}\n`);
  writeFileSync(join(directory, "tasks.md"), tasks);
}

function makeBase(root: string): void {
  mkdirSync(join(root, "plans"), { recursive: true });
  writeFileSync(join(root, "placeholder.txt"), "base\n");
  commitAll(root, "base");
  const branch = spawnSync("git", ["branch", "base"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(branch.status, 0, branch.stderr);
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

function output(capture: Capture): Record<string, unknown> {
  return decode(capture.stdout.join("").trimEnd()) as Record<string, unknown>;
}

const READY_TASKS = "# Tasks\n\n- [x] T1 Done\n";
const IN_PROGRESS_TASKS = "# Tasks\n\n- [x] T1 Done\n- [ ] T2 Later\n";
const COMPLETED_TASKS =
  "# Tasks\n\n- [x] T1 Done\n\n## Completion\n\n- Completed at: 2028-03-04T05:06:07Z\n- Mode: normal\n";

test("ready touched planlet fails with an actionable violation and no mutation", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    commitAll(root, "ready plan");
    const before = porcelain(root);

    const result = await invoke(root, ["check-completion", "--base", "base"]);

    assert.equal(result.exitCode, 4);
    assert.deepEqual(output(result.capture), {
      ok: false,
      base: "base",
      touched: ["ready-plan"],
      completed: [],
      violations: [{ slug: "ready-plan", next: "planlet complete ready-plan" }],
    });
    assert.deepEqual(porcelain(root), before);
  });
});

test("completed-in-range planlet does not violate and reports its archive paths", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "finished-plan", READY_TASKS);
    commitAll(root, "implementation");
    const implementationBase = spawnSync(
      "git",
      ["branch", "implementation-base"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    assert.equal(implementationBase.status, 0, implementationBase.stderr);
    const completed = await invoke(root, ["complete", "finished-plan"]);
    assert.equal(completed.exitCode, 0);
    commitAll(root, "complete plan");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "implementation-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "implementation-base",
      touched: [],
      completed: ["finished-plan"],
      violations: [],
    });
  });
});

test("malformed completed archive is not reported", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "broken-plan", READY_TASKS);
    commitAll(root, "implementation");
    const implementationBase = spawnSync(
      "git",
      ["branch", "implementation-base"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    assert.equal(implementationBase.status, 0, implementationBase.stderr);
    rmSync(join(root, "plans", "broken-plan"), {
      recursive: true,
      force: true,
    });
    writePlanlet(root, "2028-03-04-broken-plan", READY_TASKS, true);
    commitAll(root, "malformed archive");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "implementation-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "implementation-base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("in-progress and completed-only changes pass", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "in-progress-plan", IN_PROGRESS_TASKS);
    commitAll(root, "in progress");

    const inProgress = await invoke(root, [
      "check-completion",
      "--base",
      "base",
    ]);
    assert.equal(inProgress.exitCode, 0);
    assert.deepEqual(output(inProgress.capture), {
      ok: true,
      base: "base",
      touched: ["in-progress-plan"],
      completed: [],
      violations: [],
    });

    const completedBase = spawnSync("git", ["branch", "completed-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(completedBase.status, 0, completedBase.stderr);
    writePlanlet(root, "2028-03-04-old-plan", COMPLETED_TASKS, true);
    commitAll(root, "completed-only change");
    const completedOnly = await invoke(root, [
      "check-completion",
      "--base",
      "completed-base",
    ]);
    assert.equal(completedOnly.exitCode, 0);
    assert.deepEqual(output(completedOnly.capture), {
      ok: true,
      base: "completed-base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("active and completed logical-slug collision does not recommend completion", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "collided-plan", READY_TASKS);
    writePlanlet(root, "2028-03-04-collided-plan", COMPLETED_TASKS, true);
    commitAll(root, "collided plan");

    const result = await invoke(root, ["check-completion", "--base", "base"]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "base",
      touched: ["collided-plan"],
      completed: [],
      violations: [],
    });
    assert.doesNotMatch(result.capture.stdout.join(""), /planlet complete/);
  });
});

test("unresolvable and empty bases return git_error without mutation", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    const before = porcelain(root);

    for (const base of ["does-not-exist", "", "--output=plans/output"]) {
      const result = await invoke(root, ["check-completion", `--base=${base}`]);
      assert.equal(result.exitCode, 1);
      assert.equal(result.capture.stdout.join(""), "");
      assert.equal(
        (
          decode(result.capture.stderr.join("").trimEnd()) as {
            error: { code: string };
          }
        ).error.code,
        "git_error",
      );
      assert.deepEqual(porcelain(root), before);
    }
  });
});

test("nested Planlet roots use relative plans paths", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    const nested = join(root, "packages", "pkg");
    mkdirSync(join(nested, "plans"), { recursive: true });
    writePlanlet(nested, "nested-ready", READY_TASKS);
    commitAll(root, "nested ready plan");

    const result = await invoke(nested, ["check-completion", "--base", "base"]);

    assert.equal(result.exitCode, 4);
    assert.deepEqual(output(result.capture), {
      ok: false,
      base: "base",
      touched: ["nested-ready"],
      completed: [],
      violations: [
        { slug: "nested-ready", next: "planlet complete nested-ready" },
      ],
    });
  });
});

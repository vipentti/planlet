import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

test("a plansDir git mv of an already-ready planlet does not false-fail", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    commitAll(root, "ready plan");
    const relocateBase = spawnSync("git", ["branch", "relocate-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "docs"));
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate plans");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "relocate-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "relocate-base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("unrewritten outbound links after a deeper git mv stay touched", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    writeFileSync(
      join(root, "plans", "ready-plan", "plan.md"),
      "# ready-plan\n\nSee [design](../../placeholder.txt).\n",
    );
    commitAll(root, "ready plan");
    const relocateBase = spawnSync("git", ["branch", "stale-link-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "docs"));
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate without rewriting links");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "stale-link-base",
    ]);

    assert.equal(result.exitCode, 4);
    assert.deepEqual(output(result.capture).touched, ["ready-plan"]);
  });
});

test("a same-depth plansDir git mv rewrites outside-tree links", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    commitAll(root, "ready plan");
    mkdirSync(join(root, "docs"));
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    writeFileSync(join(root, "docs", "guide.md"), "# guide\n");
    writeFileSync(
      join(root, "docs", "plans", "ready-plan", "plan.md"),
      "# ready-plan\n\nSee [sib](../other-plan/plan.md) and [guide](../../guide.md).\n",
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "docs/plans");
    const relocateBase = spawnSync("git", ["branch", "same-depth-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "specs"));
    const relocated = spawnSync("git", ["mv", "docs/plans", "specs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocated.status, 0, relocated.stderr);
    writeFileSync(
      join(root, "specs", "plans", "ready-plan", "plan.md"),
      "# ready-plan\n\nSee [sib](../other-plan/plan.md) and [guide](../../../docs/guide.md).\n",
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "specs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "same-depth relocate");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "same-depth-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture).touched, []);
  });
});

test("chmod during plansDir relocation stays touched", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    commitAll(root, "ready plan");
    const relocateBase = spawnSync("git", ["branch", "chmod-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "docs"));
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    chmodSync(join(root, "docs", "plans", "ready-plan", "plan.md"), 0o755);
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    const add = spawnSync("git", ["add", "."], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(add.status, 0, add.stderr);
    const chmod = spawnSync(
      "git",
      ["update-index", "--chmod=+x", "docs/plans/ready-plan/plan.md"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(chmod.status, 0, chmod.stderr);
    const commit = spawnSync(
      "git",
      [
        "-c",
        "user.email=planlet@test",
        "-c",
        "user.name=Planlet Test",
        "commit",
        "-qm",
        "relocate with chmod",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(commit.status, 0, commit.stderr);

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "chmod-base",
    ]);

    assert.equal(result.exitCode, 4);
    assert.deepEqual(output(result.capture).touched, ["ready-plan"]);
  });
});

test(
  "distinct non-UTF8 Git path bytes during relocation stay touched",
  {
    skip: process.platform === "win32",
  },
  async () => {
    await withGitRoot(async (root) => {
      makeBase(root);
      writePlanlet(root, "ready-plan", READY_TASKS);
      const planDir = join(root, "plans", "ready-plan");
      writeFileSync(
        Buffer.concat([
          Buffer.from(`${planDir}/`, "utf8"),
          Buffer.from([0xff]),
        ]),
        "extra\n",
      );
      commitAll(root, "ready plan");
      const relocateBase = spawnSync("git", ["branch", "bytes-base"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(relocateBase.status, 0, relocateBase.stderr);
      mkdirSync(join(root, "docs"));
      const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(moved.status, 0, moved.stderr);
      const destDir = join(root, "docs", "plans", "ready-plan");
      renameSync(
        Buffer.concat([
          Buffer.from(`${destDir}/`, "utf8"),
          Buffer.from([0xff]),
        ]),
        Buffer.concat([
          Buffer.from(`${destDir}/`, "utf8"),
          Buffer.from([0xfe]),
        ]),
      );
      writeFileSync(
        join(root, ".planlet.json"),
        `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
      );
      commitAll(root, "relocate with path-byte rename");

      const result = await invoke(root, [
        "check-completion",
        "--base",
        "bytes-base",
      ]);

      assert.equal(result.exitCode, 4);
      assert.deepEqual(output(result.capture).touched, ["ready-plan"]);
    });
  },
);

test("non-UTF8 blob edits during plansDir relocation stay touched", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    writeFileSync(
      join(root, "plans", "ready-plan", "notes.bin"),
      Buffer.from([0xff, 0xfe, 0x00]),
    );
    commitAll(root, "ready plan");
    const relocateBase = spawnSync("git", ["branch", "binary-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "docs"));
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    writeFileSync(
      join(root, "docs", "plans", "ready-plan", "notes.bin"),
      Buffer.from([0xff, 0xfe, 0x01]),
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate with binary edit");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "binary-base",
    ]);

    assert.equal(result.exitCode, 4);
    assert.deepEqual(output(result.capture).touched, ["ready-plan"]);
  });
});

test("a plansDir git mv plus outbound link rewrite does not false-fail", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    writeFileSync(
      join(root, "plans", "ready-plan", "plan.md"),
      "# ready-plan\n\nSee [sib](../other-plan/plan.md) and [design](../../placeholder.txt).\n",
    );
    commitAll(root, "ready plan");
    const relocateBase = spawnSync("git", ["branch", "link-relocate-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "docs"));
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    const planPath = join(root, "docs", "plans", "ready-plan", "plan.md");
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace(
        "../../placeholder.txt",
        "../../../placeholder.txt",
      ),
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate plans and links");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "link-relocate-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "link-relocate-base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("a two-segment plansDir git mv plus link rewrite does not false-fail", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    writeFileSync(
      join(root, "plans", "ready-plan", "plan.md"),
      "# ready-plan\n\nSee [design](../../placeholder.txt).\n",
    );
    commitAll(root, "ready plan");
    const relocateBase = spawnSync("git", ["branch", "two-seg-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "docs", "team"), { recursive: true });
    const moved = spawnSync("git", ["mv", "plans", "docs/team/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    const planPath = join(
      root,
      "docs",
      "team",
      "plans",
      "ready-plan",
      "plan.md",
    );
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace(
        "../../placeholder.txt",
        "../../../../placeholder.txt",
      ),
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/team/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate two segments");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "two-seg-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "two-seg-base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("a deeper-to-shallower plansDir git mv plus link rewrite does not false-fail", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    writeFileSync(
      join(root, "plans", "ready-plan", "plan.md"),
      "# ready-plan\n\nSee [sib](../other-plan/plan.md) and [design](../../placeholder.txt).\n",
    );
    commitAll(root, "ready plan");
    mkdirSync(join(root, "docs", "team"), { recursive: true });
    const deepened = spawnSync("git", ["mv", "plans", "docs/team/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(deepened.status, 0, deepened.stderr);
    const deepPlan = join(
      root,
      "docs",
      "team",
      "plans",
      "ready-plan",
      "plan.md",
    );
    writeFileSync(
      deepPlan,
      readFileSync(deepPlan, "utf8").replace(
        "../../placeholder.txt",
        "../../../../placeholder.txt",
      ),
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/team/plans" }, null, 2)}\n`,
    );
    commitAll(root, "deep plans");
    const relocateBase = spawnSync("git", ["branch", "shallow-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    const moved = spawnSync("git", ["mv", "docs/team/plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    const planPath = join(root, "docs", "plans", "ready-plan", "plan.md");
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace(
        "../../../../placeholder.txt",
        "../../../placeholder.txt",
      ),
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate shallower");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "shallow-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "shallow-base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("a one-level move still relocates when the unadjusted new-relative target exists", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writeFileSync(join(root, "README.md"), "# root\n");
    writePlanlet(root, "ready-plan", READY_TASKS);
    writeFileSync(
      join(root, "plans", "ready-plan", "plan.md"),
      "# ready-plan\n\nSee [design](../../README.md).\n",
    );
    commitAll(root, "ready plan");
    const relocateBase = spawnSync("git", ["branch", "ambiguous-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "README.md"), "# docs\n");
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    const planPath = join(root, "docs", "plans", "ready-plan", "plan.md");
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace(
        "../../README.md",
        "../../../README.md",
      ),
    );
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate with sibling README");

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "ambiguous-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "ambiguous-base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("check-completion uses merge-base plansDir when the named base later diverges", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    writePlanlet(root, "ready-plan", READY_TASKS);
    commitAll(root, "ready plan");
    const current = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(current.status, 0, current.stderr);
    const currentBranch = current.stdout.trim();
    mkdirSync(join(root, "docs"));
    const moved = spawnSync("git", ["mv", "plans", "docs/plans"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(moved.status, 0, moved.stderr);
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "relocate plans");
    const diverged = spawnSync("git", ["branch", "diverged", "HEAD~1"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(diverged.status, 0, diverged.stderr);
    const checkoutDiverged = spawnSync("git", ["checkout", "-q", "diverged"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(checkoutDiverged.status, 0, checkoutDiverged.stderr);
    writeFileSync(
      join(root, ".planlet.json"),
      `${JSON.stringify({ plansDir: "other" }, null, 2)}\n`,
    );
    commitAll(root, "diverge base config");
    const checkoutBack = spawnSync("git", ["checkout", "-q", currentBranch], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(checkoutBack.status, 0, checkoutBack.stderr);

    const result = await invoke(root, [
      "check-completion",
      "--base",
      "diverged",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "diverged",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("nested Planlet roots honor a committed .planlet.json after git mv", async () => {
  await withGitRoot(async (root) => {
    makeBase(root);
    const nested = join(root, "packages", "pkg");
    mkdirSync(join(nested, "plans"), { recursive: true });
    writePlanlet(nested, "nested-ready", READY_TASKS);
    commitAll(root, "nested ready plan");
    const relocateBase = spawnSync("git", ["branch", "nested-relocate-base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(relocateBase.status, 0, relocateBase.stderr);
    mkdirSync(join(nested, "docs"));
    const moved = spawnSync(
      "git",
      ["mv", "packages/pkg/plans", "packages/pkg/docs/plans"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(moved.status, 0, moved.stderr);
    writeFileSync(
      join(nested, ".planlet.json"),
      `${JSON.stringify({ plansDir: "docs/plans" }, null, 2)}\n`,
    );
    commitAll(root, "nested relocate");

    const result = await invoke(nested, [
      "check-completion",
      "--base",
      "nested-relocate-base",
    ]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "nested-relocate-base",
      touched: [],
      completed: [],
      violations: [],
    });
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

test("repo without plans directory reports no plans without error", async () => {
  await withGitRoot(async (root) => {
    writeFileSync(join(root, "README.md"), "# repo\n");
    commitAll(root, "initial");
    const branch = spawnSync("git", ["branch", "base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(branch.status, 0, branch.stderr);
    writeFileSync(join(root, "other.txt"), "change\n");
    commitAll(root, "other change");

    const result = await invoke(root, ["check-completion", "--base", "base"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.capture.stderr.join(""), "");
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

test("repo without plans directory and no diff still passes", async () => {
  await withGitRoot(async (root) => {
    writeFileSync(join(root, "README.md"), "# repo\n");
    commitAll(root, "initial");
    const branch = spawnSync("git", ["branch", "base"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(branch.status, 0, branch.stderr);

    const result = await invoke(root, ["check-completion", "--base", "base"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.capture.stderr.join(""), "");
    assert.deepEqual(output(result.capture), {
      ok: true,
      base: "base",
      touched: [],
      completed: [],
      violations: [],
    });
  });
});

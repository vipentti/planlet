import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { before } from "node:test";

import { decode } from "@toon-format/toon";

import { EXIT_CODES } from "../../src/errors/codes.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executable = join(packageRoot, "dist", "planlet.mjs");

interface Invocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * These fixtures cover only what in-process handler tests cannot reach: argv
 * parsing, real stdout/stderr framing, and process exit codes. Build first so
 * they always exercise the current source rather than a stale bundle.
 */
before(() => {
  const built = spawnSync(
    process.execPath,
    [join(packageRoot, "scripts", "build.mjs")],
    {
      cwd: packageRoot,
      encoding: "utf8",
    },
  );
  assert.equal(built.status, 0, `build failed: ${built.stderr}`);
});

function runCli(arguments_: readonly string[], cwd: string): Invocation {
  const result = spawnSync(process.execPath, [executable, ...arguments_], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function withRepository(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-compiled-"));
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
  slug: string,
  tasks: string,
  plan = `# ${slug}\n\n## Summary\nFixture.\n\n## Scope\nFixture.\n\n## Approach\nFixture.\n\n## Acceptance Criteria\n- Works.\n\n## Verification\nTests.\n`,
): void {
  const directory = join(root, "plans", slug);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "plan.md"), plan);
  writeFileSync(join(directory, "tasks.md"), tasks);
}

test("--version prints the package version identically from tsx and the bundle", () => {
  const expected = `${(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version}\n`;

  const bundled = runCli(["--version"], packageRoot);
  assert.equal(bundled.exitCode, EXIT_CODES.success);
  assert.equal(bundled.stdout, expected);
  assert.equal(bundled.stderr, "");

  const fromSource = spawnSync(
    process.execPath,
    ["--import", "tsx", join(packageRoot, "src", "index.ts"), "--version"],
    { cwd: packageRoot, encoding: "utf8" },
  );
  assert.equal(fromSource.status, 0, fromSource.stderr);
  assert.equal(fromSource.stdout, expected);
});

test("help is written to stdout and exits successfully", () => {
  withRepository((root) => {
    const result = runCli(["help"], root);

    assert.equal(result.exitCode, EXIT_CODES.success);
    assert.match(result.stdout, /^Usage: planlet /);
    assert.match(result.stdout, /task check\|uncheck <slug> <task-id>/);
    assert.equal(result.stderr, "");
  });
});

test("no arguments renders the dashboard as TOON on stdout", () => {
  withRepository((root) => {
    writePlanlet(root, "alpha", "# Tasks: Alpha\n\n- [x] T1 Done\n");
    writePlanlet(root, "beta", "# Tasks: Beta\n\n- [ ] T1 Pending\n");

    const result = runCli([], root);

    assert.equal(result.exitCode, EXIT_CODES.success);
    assert.equal(result.stderr, "");
    assert.deepEqual(decode(result.stdout.trimEnd()), {
      plans: [
        { slug: "alpha", state: "ready_to_complete", done: 1, total: 1 },
        { slug: "beta", state: "planned", done: 0, total: 1 },
      ],
      summary: { active: 2, ready: 1, invalid: 0 },
    });
  });
});

test("--root selects the repository when invoked from an unrelated directory", () => {
  withRepository((root) => {
    writePlanlet(
      root,
      "remote-root",
      "# Tasks: Remote Root\n\n- [ ] T1 Pending\n",
    );
    const elsewhere = mkdtempSync(join(tmpdir(), "planlet-cwd-"));

    try {
      const result = runCli(
        ["--root", root, "tasks", "remote-root"],
        elsewhere,
      );

      assert.equal(result.exitCode, EXIT_CODES.success);
      assert.equal(result.stderr, "");
      assert.deepEqual(decode(result.stdout.trimEnd()), {
        slug: "remote-root",
        tasks: [{ id: "T1", description: "Pending", completed: false }],
        completedTasks: 0,
        totalTasks: 1,
      });
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

test("large content truncates by default and --full restores it", () => {
  withRepository((root) => {
    const body = "x".repeat(5_000);
    writePlanlet(
      root,
      "large",
      "# Tasks: Large\n\n- [ ] T1 Pending\n",
      `# Large\n\n## Summary\n${body}\n\n## Scope\nFixture.\n\n## Approach\nFixture.\n\n## Acceptance Criteria\n- Works.\n\n## Verification\nTests.\n`,
    );

    const truncated = runCli(["show", "large", "--part", "plan"], root);
    assert.equal(truncated.exitCode, EXIT_CODES.success);
    assert.equal(truncated.stderr, "");
    assert.match(truncated.stdout, /truncated: true/);
    assert.match(truncated.stdout, /Re-run with --full for complete content/);
    assert.ok(!truncated.stdout.includes(body));

    const full = runCli(["--full", "show", "large", "--part", "plan"], root);
    assert.equal(full.exitCode, EXIT_CODES.success);
    assert.equal(full.stderr, "");
    assert.ok(!full.stdout.includes("Re-run with --full"));
    assert.ok(full.stdout.includes(body));
  });
});

test("an unknown command exits with the usage code and writes nothing to stdout", () => {
  withRepository((root) => {
    const result = runCli(["nonsense"], root);

    assert.equal(result.exitCode, EXIT_CODES.usage);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /usage: Unknown command: nonsense/);
    assert.match(result.stderr, /planlet help/);
  });
});

test("an unknown option exits with the usage code", () => {
  withRepository((root) => {
    const result = runCli(["list", "--not-a-flag"], root);

    assert.equal(result.exitCode, EXIT_CODES.usage);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^usage: /);
  });
});

test("structured errors go to stderr with their mapped exit codes", () => {
  withRepository((root) => {
    writePlanlet(root, "present", "# Tasks: Present\n\n- [ ] T1 Pending\n");

    const missing = runCli(["show", "absent"], root);
    assert.equal(missing.exitCode, EXIT_CODES.operational);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /code: plan_not_found/);

    const invalidSlug = runCli(["show", "Not A Slug"], root);
    assert.equal(invalidSlug.exitCode, EXIT_CODES.usage);
    assert.equal(invalidSlug.stdout, "");
    assert.match(invalidSlug.stderr, /code: invalid_slug/);

    const incomplete = runCli(["complete", "present"], root);
    assert.equal(incomplete.exitCode, EXIT_CODES.stateTransition);
    assert.equal(incomplete.stdout, "");
    assert.match(incomplete.stderr, /code: incomplete_tasks/);
  });
});

test("task check mutates tasks.md through the compiled executable", () => {
  withRepository((root) => {
    writePlanlet(root, "mutable", "# Tasks: Mutable\n\n- [ ] T1 Pending\n");

    const result = runCli(["task", "check", "mutable", "T1"], root);

    assert.equal(result.exitCode, EXIT_CODES.success);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /slug: mutable/);
    assert.equal(
      readFileSync(join(root, "plans", "mutable", "tasks.md"), "utf8"),
      "# Tasks: Mutable\n\n- [x] T1 Pending\n",
    );
  });
});

test("warnings reach stderr while data stays on stdout and the exit code stays successful", () => {
  withRepository((root) => {
    writePlanlet(root, "override", "# Tasks: Override\n\n- [ ] T1 Pending\n");

    const completed = runCli(
      ["complete", "override", "--allow-incomplete", "--reason", "deferred"],
      root,
    );
    assert.equal(completed.exitCode, EXIT_CODES.success);

    const listed = runCli(["list", "--completed"], root);

    assert.equal(listed.exitCode, EXIT_CODES.success);
    assert.deepEqual(decode(listed.stdout.trimEnd()), {
      plans: [{ slug: "override", state: "completed", done: 0, total: 1 }],
    });
    assert.doesNotMatch(listed.stdout, /diagnostics/);
    assert.match(
      listed.stderr,
      /Completed planlet contains an incomplete-task override/,
    );
  });
});

test("tasks, task updates, and completion route plan warnings to stderr", () => {
  withRepository((root) => {
    writePlanlet(
      root,
      "warning-route",
      "# Tasks: Warning Route\n\n- [ ] T1 Pending\n",
      "# Warning Route\n",
    );

    const tasks = runCli(["tasks", "warning-route"], root);
    assert.equal(tasks.exitCode, EXIT_CODES.success);
    assert.match(tasks.stderr, /missing recommended sections/);
    assert.doesNotMatch(tasks.stdout, /diagnostics|warnings/);

    const checked = runCli(["task", "check", "warning-route", "T1"], root);
    assert.equal(checked.exitCode, EXIT_CODES.success);
    assert.match(checked.stderr, /missing recommended sections/);
    assert.doesNotMatch(checked.stdout, /diagnostics|warnings/);

    const completed = runCli(["complete", "warning-route"], root);
    assert.equal(completed.exitCode, EXIT_CODES.success);
    assert.match(completed.stderr, /missing recommended sections/);
    assert.doesNotMatch(completed.stdout, /diagnostics|warnings/);
  });
});

test("compiled init resolves and installs packaged canonical skills", () => {
  withRepository((root) => {
    const result = runCli(["init", "--tools", "agents"], root);

    assert.equal(result.exitCode, EXIT_CODES.success, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(
      readFileSync(
        join(root, ".agents", "skills", "planlet-implement", "SKILL.md"),
      ),
      readFileSync(
        join(packageRoot, "skills", "planlet-implement", "SKILL.md"),
      ),
    );
    assert.equal(
      runCli(["init", "--tools", "agents"], root).stdout.includes(
        "changed: false",
      ),
      true,
    );
  });
});

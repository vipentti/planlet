import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
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
  plan = `# ${slug}

## Summary
Fixture.

## Scope
Fixture.

## Approach
Fixture.

## Acceptance Criteria
- Works.

## Verification
Tests.
`,
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

test("show --part plan|tasks compacts large content with the exact schema", () => {
  withRepository((root) => {
    const body = "x".repeat(5_000);
    const plan = `# Large

## Summary
${body}

## Scope
Fixture.

## Approach
Fixture.

## Acceptance Criteria
- Works.

## Verification
Tests.
`;
    const tasks = `# Tasks: Large

- [ ] T1 ${body}
`;
    writePlanlet(root, "large", tasks, plan);

    const compacted = (content: string) => ({
      preview: `${Array.from(content).slice(0, 4_096).join("")}…`,
      truncated: true,
      originalCharacters: Array.from(content).length,
      shownCharacters: 4_096,
      hint: "Re-run with --full for complete content",
    });

    for (const part of ["plan", "tasks"] as const) {
      const truncated = runCli(["show", "large", "--part", part], root);
      assert.equal(truncated.exitCode, EXIT_CODES.success);
      assert.equal(truncated.stderr, "");
      assert.deepEqual(decode(truncated.stdout.trimEnd()), {
        slug: "large",
        part,
        content: compacted(part === "plan" ? plan : tasks),
      });
    }

    const full = runCli(["--full", "show", "large", "--part", "plan"], root);
    assert.equal(full.exitCode, EXIT_CODES.success);
    assert.equal(full.stderr, "");
    assert.deepEqual(decode(full.stdout.trimEnd()), {
      slug: "large",
      part: "plan",
      content: plan,
    });
  });
});

test("show --part summary is emitted unchanged", () => {
  withRepository((root) => {
    const body = "x".repeat(5_000);
    writePlanlet(
      root,
      "large",
      `# Tasks: Large

- [ ] T1 Pending
`,
      `# Large

## Summary
${body}

## Scope
Fixture.

## Approach
Fixture.

## Acceptance Criteria
- Works.

## Verification
Tests.
`,
    );

    const result = runCli(["show", "large", "--part", "summary"], root);
    assert.equal(result.exitCode, EXIT_CODES.success);
    assert.equal(result.stderr, "");
    assert.deepEqual(decode(result.stdout.trimEnd()), {
      slug: "large",
      part: "summary",
      summary: {
        slug: "large",
        title: "Large",
        state: "planned",
        completedTasks: 0,
        totalTasks: 1,
        path: join(realpathSync(root), "plans", "large"),
        warnings: [],
      },
    });
  });
});

test("non-show payloads are emitted completely", () => {
  withRepository((root) => {
    const body = "y".repeat(5_000);
    writePlanlet(
      root,
      "large",
      `# Tasks: Large

- [ ] T1 ${body}
`,
    );

    const result = runCli(["tasks", "large"], root);
    assert.equal(result.exitCode, EXIT_CODES.success);
    assert.equal(result.stderr, "");
    assert.deepEqual(decode(result.stdout.trimEnd()), {
      slug: "large",
      tasks: [{ id: "T1", description: body, completed: false }],
      completedTasks: 0,
      totalTasks: 1,
    });
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
    assert.deepEqual(decode(result.stdout.trimEnd()), {
      slug: "mutable",
      task: { id: "T1", description: "Pending", completed: true },
      changed: true,
      state: "ready_to_complete",
      done: 1,
      total: 1,
      next: "planlet complete mutable",
    });
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

test("compiled validate treats completed normal+unchecked as invalid_plan", () => {
  withRepository((root) => {
    const archive = join(root, "plans", "completed", "2026-07-22-bad-complete");
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "plan.md"), "# Bad Complete\n");
    writeFileSync(
      join(archive, "tasks.md"),
      `# Tasks: Bad Complete

- [x] T1 Done
- [ ] T2 Left

## Completion

- Completed at: 2026-07-22T12:00:00.000Z
- Mode: normal
`,
    );

    const targeted = runCli(["validate", "bad-complete"], root);
    assert.equal(targeted.exitCode, EXIT_CODES.invalidPlan);
    assert.match(targeted.stdout, /invalid_plan/);
    assert.match(targeted.stdout, /unchecked tasks without an override/);

    const all = runCli(["validate", "--all"], root);
    assert.equal(all.exitCode, EXIT_CODES.invalidPlan);
    assert.match(all.stdout, /invalid_plan/);
  });
});

test("compiled validate for Prettier wrapped task is valid and returns complete description", async () => {
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
  withRepository((root) => {
    writePlanlet(root, "prettier-wrapped", wrapped);
    const validated = runCli(["validate", "prettier-wrapped"], root);
    assert.equal(validated.exitCode, EXIT_CODES.success);
    const tasks = runCli(["tasks", "prettier-wrapped"], root);
    assert.equal(tasks.exitCode, EXIT_CODES.success);
    const decoded = decode(tasks.stdout.trimEnd()) as {
      tasks: Array<{ id: string; description: string }>;
    };
    assert.equal(decoded.tasks.length, 1);
    assert.equal(decoded.tasks[0]?.description, long);
  });
});

test("production entry emits internal_error without stack by default", async () => {
  const { runProductionEntry, renderUnexpectedError } =
    await import("../../src/production-entry.js");
  const rendered = renderUnexpectedError(new Error("boom /tmp/secret"));
  assert.equal(rendered.exitCode, EXIT_CODES.operational);
  assert.match(rendered.stderr, /internal_error/);
  assert.doesNotMatch(rendered.stderr, /boom|\/tmp\/secret|stack/i);

  process.env.PLANLET_DEBUG = "1";
  try {
    const debug = renderUnexpectedError(new Error("boom /tmp/secret"));
    assert.match(debug.stderr, /boom \/tmp\/secret/);
  } finally {
    delete process.env.PLANLET_DEBUG;
  }

  const { PlanletError } = await import("../../src/errors/planlet-error.js");
  const { renderToonError } = await import("../../src/output/toon.js");
  const passthrough = renderToonError(
    new PlanletError("plan_not_found", "Planlet not found: missing", {
      details: { slug: "missing" },
      next: "planlet list",
    }).toStructuredError(),
  );
  assert.match(passthrough.stderr, /plan_not_found/);
  assert.match(passthrough.stderr, /planlet list/);
  assert.doesNotMatch(passthrough.stderr, /internal_error/);

  const chunks: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  let code: number;
  try {
    code = await runProductionEntry(async () => {
      throw new Error("unexpected path /home/secret");
    });
  } finally {
    process.stderr.write = write;
  }
  assert.equal(code, EXIT_CODES.operational);
  assert.match(chunks.join(""), /internal_error/);
  assert.doesNotMatch(chunks.join(""), /\/home\/secret/);
});

test("leftover harness recovery directories emit top-level next on stderr", () => {
  withRepository((root) => {
    const skills = join(root, ".agents", "skills");
    mkdirSync(join(skills, ".planlet-bak-dead"), { recursive: true });
    const result = runCli(["init", "--tools", "agents"], root);
    assert.equal(result.exitCode, EXIT_CODES.filesystemConflict);
    assert.match(result.stderr, /write_conflict/);
    assert.match(result.stderr, /Inspect leftover/);
    assert.match(result.stderr, /leftoverPaths|planlet-bak-dead/);
    assert.doesNotMatch(result.stdout, /Inspect leftover/);
  });
});

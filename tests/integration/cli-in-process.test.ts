import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decode } from "@toon-format/toon";

import { main, type CliRuntime } from "../../src/cli.js";
import {
  handleList,
  type ExecutionContext,
} from "../../src/commands/handlers.js";

interface Capture {
  readonly stdout: string[];
  readonly stderr: string[];
}

async function withRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "planlet-cli-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "plans"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePlanlet(root: string, slug: string, tasks: string): void {
  const directory = join(root, "plans", slug);
  mkdirSync(directory);
  writeFileSync(join(directory, "plan.md"), `# ${slug}\n`);
  writeFileSync(join(directory, "tasks.md"), tasks);
}

function captureRuntime(
  cwd: string,
  clock = () => new Date("2028-03-04T05:06:07Z"),
): { readonly capture: Capture; readonly runtime: CliRuntime } {
  const capture: Capture = { stdout: [], stderr: [] };
  return {
    capture,
    runtime: {
      cwd,
      stdout: (value) => capture.stdout.push(value),
      stderr: (value) => capture.stderr.push(value),
      clock,
    },
  };
}

function executionContext(root: string, capture: Capture): ExecutionContext {
  return {
    root,
    stdout: (value) => capture.stdout.push(value),
    stderr: (value) => capture.stderr.push(value),
    clock: () => new Date("2028-03-04T05:06:07Z"),
  };
}

function decoded(output: readonly string[]): unknown {
  return decode(output.join("").trimEnd());
}

test("command handlers are directly callable with an injected execution context", async () => {
  await withRepository(async (root) => {
    writePlanlet(
      root,
      "direct-call",
      "# Tasks: Direct Call\n\n- [ ] T1 Run directly\n",
    );
    const capture: Capture = { stdout: [], stderr: [] };

    assert.equal(handleList({}, executionContext(root, capture)), 0);
    assert.deepEqual(decoded(capture.stdout), {
      plans: [
        {
          slug: "direct-call",
          state: "planned",
          done: 0,
          total: 1,
        },
      ],
    });
  });
});

test("in-process parsing requires globals before task commands", async () => {
  await withRepository(async (root) => {
    const tasksPath = join(root, "plans", "dispatch-plan", "tasks.md");
    writePlanlet(
      root,
      "dispatch-plan",
      "# Tasks: Dispatch Plan\n\n- [ ] T1 Dispatch this\n",
    );
    const { capture, runtime } = captureRuntime(tmpdir());

    assert.equal(
      await main(
        ["task", "check", "dispatch-plan", "T1", "--root", root],
        runtime,
      ),
      2,
    );
    assert.equal(
      await main(
        ["--root", root, "task", "check", "dispatch-plan", "T1"],
        runtime,
      ),
      0,
    );
    assert.match(readFileSync(tasksPath, "utf8"), /- \[x\] T1 Dispatch this/);
    assert.equal(
      await main(["--root", root, "status", "dispatch-plan"], runtime),
      0,
    );

    const outputs = capture.stdout.map((value) => decode(value.trimEnd()));
    assert.equal((outputs[0] as { changed: boolean }).changed, true);
    assert.deepEqual(outputs[1], {
      plan: {
        slug: "dispatch-plan",
        state: "ready_to_complete",
        done: 1,
        total: 1,
      },
    });
  });
});

test("in-process dispatch routes create and read-only command flags", async () => {
  await withRepository(async (root) => {
    const { capture, runtime } = captureRuntime(root);

    assert.equal(
      await main(["create", "routed-plan", "--title", "Routed Plan"], runtime),
      0,
    );
    writeFileSync(
      join(root, "plans", "routed-plan", "tasks.md"),
      "# Tasks: Routed Plan\n\n- [ ] T1 Route this\n",
    );
    assert.equal(await main(["list", "--state", "planned"], runtime), 0);
    assert.equal(
      await main(["show", "routed-plan", "--part", "plan"], runtime),
      0,
    );
    assert.equal(await main(["validate", "routed-plan"], runtime), 0);
    assert.equal(
      await main(["tasks", "routed-plan", "--remaining"], runtime),
      0,
    );

    const outputs = capture.stdout.map((value) =>
      decode(value.trimEnd()),
    ) as Array<Record<string, unknown>>;
    assert.equal((outputs[0]?.plan as { slug: string }).slug, "routed-plan");
    assert.deepEqual(outputs[1], {
      plans: [{ slug: "routed-plan", state: "planned", done: 0, total: 1 }],
    });
    assert.equal(outputs[2]?.part, "plan");
    assert.equal(outputs[3]?.valid, true);
    assert.deepEqual(
      (outputs[4]?.tasks as Array<{ id: string }>).map((task) => task.id),
      ["T1"],
    );
  });
});

test("content-only show parts preserve advisory warnings", async () => {
  await withRepository(async (root) => {
    writePlanlet(
      root,
      "warning-plan",
      "# Tasks: Warning Plan\n\n- [x] T1 Done\n\n## Completion\n\n- Completed at: 2028-03-04T05:06:07Z\n- Mode: normal\n",
    );

    for (const part of ["plan", "tasks"] as const) {
      const { capture, runtime } = captureRuntime(root);

      assert.equal(
        await main(["show", "warning-plan", "--part", part], runtime),
        0,
      );
      assert.match(
        capture.stderr.join(""),
        /Active planlet contains a completion record/,
      );
    }
  });
});

test("public main handles command help without repository discovery", async () => {
  const { capture, runtime } = captureRuntime(
    "/path/that/does/not/need/to/exist",
  );

  assert.equal(await main(["list", "--help"], runtime), 0);
  assert.match(capture.stdout.join(""), /^Usage: planlet list /);
  assert.deepEqual(capture.stderr, []);
});

test("global-looking option values are not consumed as globals or help", async () => {
  await withRepository(async (root) => {
    for (const arguments_ of [
      ["create", "root-value", "--title", "--root", root],
      ["create", "help-value", "--title", "--help"],
    ]) {
      const { capture, runtime } = captureRuntime(root);
      assert.equal(await main(arguments_, runtime), 2);
      assert.equal(capture.stdout.join(""), "");
      assert.match(capture.stderr.join(""), /^usage: /);
    }
  });
});

test("main passes the injected clock to completion", async () => {
  await withRepository(async (root) => {
    writePlanlet(
      root,
      "clock-plan",
      "# Tasks: Clock Plan\n\n- [x] T1 Complete this\n",
    );
    let clockReads = 0;
    const { capture, runtime } = captureRuntime(root, () => {
      clockReads += 1;
      return new Date("2028-03-04T05:06:07Z");
    });

    assert.equal(
      await main(["--root", root, "complete", "clock-plan"], runtime),
      0,
    );
    assert.equal(clockReads, 1);
    const result = decoded(capture.stdout) as {
      archiveName: string;
      completedAt: string;
    };
    assert.equal(result.archiveName, "2028-03-04-clock-plan");
    assert.equal(result.completedAt, "2028-03-04T05:06:07.000Z");
  });
});

test("no arguments render the compact active-plan dashboard", async () => {
  await withRepository(async (root) => {
    writePlanlet(
      root,
      "active-plan",
      "# Tasks: Active Plan\n\n- [x] T1 Done\n- [ ] T2 Remaining\n",
    );
    writePlanlet(root, "ready-plan", "# Tasks: Ready Plan\n\n- [x] T1 Done\n");
    const { capture, runtime } = captureRuntime(root);

    assert.equal(await main([], runtime), 0);
    assert.deepEqual(decoded(capture.stdout), {
      plans: [
        { slug: "active-plan", state: "in_progress", done: 1, total: 2 },
        {
          slug: "ready-plan",
          state: "ready_to_complete",
          done: 1,
          total: 1,
        },
      ],
      summary: { active: 2, ready: 1, invalid: 0 },
    });
  });
});

test("help is explicit and does not require repository discovery", async () => {
  const empty = mkdtempSync(join(tmpdir(), "planlet-help-"));
  try {
    const { capture, runtime } = captureRuntime(empty);
    assert.equal(await main(["help"], runtime), 0);
    assert.match(capture.stdout.join(""), /^Usage: planlet/);
    assert.equal(capture.stderr.join(""), "");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

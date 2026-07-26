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

interface Capture {
  readonly stdout: string[];
  readonly stderr: string[];
}

function withRepository(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-skill-"));
  mkdirSync(join(root, ".git"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runtime(root: string): { capture: Capture; runtime: CliRuntime } {
  const capture: Capture = { stdout: [], stderr: [] };
  return {
    capture,
    runtime: {
      cwd: root,
      stdout: (value) => capture.stdout.push(value),
      stderr: (value) => capture.stderr.push(value),
      clock: () => new Date("2029-04-05T06:07:08Z"),
    },
  };
}

function lastOutput(capture: Capture): Record<string, unknown> {
  return decode(capture.stdout.at(-1)!.trimEnd()) as Record<string, unknown>;
}

test("planning workflow creates stubs, populates them, validates, and inspects full content", () => {
  withRepository((root) => {
    const captureRuntime = runtime(root);
    assert.equal(
      main(
        ["--root", root, "create", "skill-plan", "--title", "Skill Plan"],
        captureRuntime.runtime,
      ),
      0,
    );
    writeFileSync(
      join(root, "plans", "skill-plan", "plan.md"),
      "# Skill Plan\n\n## Summary\nOutcome.\n\n## Scope\nScope.\n\n## Approach\nApproach.\n\n## Acceptance Criteria\n\n- Works.\n\n## Verification\n\nRun tests.\n",
    );
    writeFileSync(
      join(root, "plans", "skill-plan", "tasks.md"),
      "# Tasks: Skill Plan\n\n- [ ] T1 Deliver outcome\n",
    );

    assert.equal(
      main(["--root", root, "validate", "skill-plan"], captureRuntime.runtime),
      0,
    );
    assert.equal(
      main(
        ["--root", root, "--full", "show", "skill-plan", "--part", "plan"],
        captureRuntime.runtime,
      ),
      0,
    );
    assert.match(
      lastOutput(captureRuntime.capture).content as string,
      /## Acceptance Criteria/,
    );
  });
});

test("implementation workflow checks verified task and reinspects canonical progress", () => {
  withRepository((root) => {
    mkdirSync(join(root, "plans", "implement-plan"), { recursive: true });
    writeFileSync(
      join(root, "plans", "implement-plan", "plan.md"),
      "# Implement Plan\n",
    );
    writeFileSync(
      join(root, "plans", "implement-plan", "tasks.md"),
      "# Tasks: Implement Plan\n\n- [ ] T1 Verified outcome\n- [ ] T2 Remaining outcome\n",
    );
    const captureRuntime = runtime(root);

    assert.equal(
      main(
        ["--root", root, "task", "check", "implement-plan", "T1"],
        captureRuntime.runtime,
      ),
      0,
    );
    assert.equal(
      main(
        ["--root", root, "tasks", "implement-plan", "--remaining"],
        captureRuntime.runtime,
      ),
      0,
    );
    assert.deepEqual(
      (lastOutput(captureRuntime.capture).tasks as Array<{ id: string }>).map(
        (task) => task.id,
      ),
      ["T2"],
    );
    assert.match(
      readFileSync(join(root, "plans", "implement-plan", "tasks.md"), "utf8"),
      /- \[x\] T1 Verified outcome/,
    );
  });
});

test("completion workflow refuses incomplete work then records approved override", () => {
  withRepository((root) => {
    mkdirSync(join(root, "plans", "complete-plan"), { recursive: true });
    writeFileSync(
      join(root, "plans", "complete-plan", "plan.md"),
      "# Complete Plan\n",
    );
    writeFileSync(
      join(root, "plans", "complete-plan", "tasks.md"),
      "# Tasks: Complete Plan\n\n- [x] T1 Done\n- [ ] T2 Deferred\n",
    );
    const captureRuntime = runtime(root);

    assert.equal(
      main(
        ["--root", root, "complete", "complete-plan"],
        captureRuntime.runtime,
      ),
      4,
    );
    assert.match(captureRuntime.capture.stderr.at(-1)!, /incomplete_tasks/);
    assert.equal(
      main(
        [
          "--root",
          root,
          "complete",
          "complete-plan",
          "--allow-incomplete",
          "--reason",
          "Deferred by reviewer",
        ],
        captureRuntime.runtime,
      ),
      0,
    );
    assert.equal(
      lastOutput(captureRuntime.capture).mode,
      "incomplete override",
    );
    const archivedTasks = readFileSync(
      join(root, "plans", "completed", "2029-04-05-complete-plan", "tasks.md"),
      "utf8",
    );
    assert.match(archivedTasks, /- Remaining tasks: T2/);
    assert.match(archivedTasks, /- Reason: Deferred by reviewer/);
  });
});

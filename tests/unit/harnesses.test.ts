import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeToolSelector,
  resolveHarnessDestinations,
} from "../../src/core/harnesses.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-harnesses-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("tool selectors trim, deduplicate, and retain registry order", () => {
  assert.deepEqual(normalizeToolSelector(" codex,agents,codex "), [
    "agents",
    "codex",
  ]);
  assert.deepEqual(normalizeToolSelector(undefined), [
    "agents",
    "claude",
    "codex",
  ]);
  assert.deepEqual(normalizeToolSelector("none"), []);
});

test("exclusive, empty, and unknown selectors fail as unsupported tools", () => {
  for (const selector of [
    "",
    "agents,",
    "all,claude",
    "none,codex",
    "gemini",
  ]) {
    assert.throws(
      () => normalizeToolSelector(selector),
      (error) =>
        error instanceof PlanletError && error.code === "unsupported_tool",
      selector,
    );
  }
});

test("shared harness destinations are coalesced with stable aliases", () => {
  withRoot((root) => {
    const destinations = resolveHarnessDestinations(
      root,
      normalizeToolSelector("codex,agents"),
    );

    assert.equal(destinations.length, 1);
    assert.deepEqual(destinations[0], {
      path: join(realpathSync(root), ".agents", "skills"),
      relativePath: ".agents/skills",
      selectedToolIds: ["agents", "codex"],
      aliases: ["agents", "codex"],
    });
  });
});

test("destination resolution rejects escaping symlinks", () => {
  const outside = mkdtempSync(join(tmpdir(), "planlet-harnesses-outside-"));
  try {
    withRoot((root) => {
      mkdirSync(join(root, ".agents"));
      symlinkSync(outside, join(root, ".agents", "skills"));
      assert.throws(
        () => resolveHarnessDestinations(root, normalizeToolSelector("agents")),
        (error) =>
          error instanceof PlanletError && error.code === "unsafe_path",
      );
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  HARNESS_ADAPTERS,
  detectHarnessSignals,
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

const markers = HARNESS_ADAPTERS.flatMap((adapter) =>
  adapter.presenceMarkers.map((marker) => ({
    id: adapter.id,
    path: marker.relativePath,
    kind: marker.kind,
  })),
);

test("harness signals detect every known repository marker", () => {
  for (const marker of markers) {
    withRoot((root) => {
      const path = join(root, marker.path);
      if (marker.kind === "directory") {
        mkdirSync(path, { recursive: true });
      } else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "");
      }
      assert.deepEqual(detectHarnessSignals(root), [marker.id], marker.path);
    });
  }
});

test("harness signals ignore missing and wrong-kind markers", () => {
  withRoot((root) => {
    assert.deepEqual(detectHarnessSignals(root), []);
  });

  for (const marker of markers) {
    withRoot((root) => {
      const path = join(root, marker.path);
      if (marker.kind === "directory") {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "not a directory\n");
      } else {
        mkdirSync(path, { recursive: true });
      }
      assert.deepEqual(detectHarnessSignals(root), [], marker.path);
    });
  }
});

test("Planlet-only skill footprints do not signal agents or Claude", () => {
  withRoot((root) => {
    for (const destination of [".agents/skills", ".claude/skills"]) {
      mkdirSync(join(root, destination, "planlet-example"), {
        recursive: true,
      });
      writeFileSync(join(root, destination, ".planlet-manifest.json"), "{}\n");
    }
    assert.deepEqual(detectHarnessSignals(root), []);
  });
});

test("escaping agents skills symlink does not signal agents", () => {
  const outside = mkdtempSync(join(tmpdir(), "planlet-harnesses-outside-"));
  try {
    withRoot((root) => {
      mkdirSync(join(root, ".agents"));
      symlinkSync(outside, join(root, ".agents", "skills"));
      assert.deepEqual(detectHarnessSignals(root), []);
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("non-Planlet skill entries signal their harness", () => {
  withRoot((root) => {
    for (const destination of [".agents/skills", ".claude/skills"]) {
      mkdirSync(join(root, destination, "user-skill"), { recursive: true });
    }
    assert.deepEqual(detectHarnessSignals(root), ["agents", "claude"]);
  });
});

test("tool selectors trim, deduplicate, and retain registry order", () => {
  assert.deepEqual(normalizeToolSelector(" codex,agents,codex "), [
    "agents",
    "codex",
  ]);
  assert.deepEqual(normalizeToolSelector(undefined), [
    "agents",
    "claude",
    "codex",
    "github-copilot",
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
      normalizeToolSelector("codex,agents,github-copilot"),
    );

    assert.equal(destinations.length, 1);
    assert.deepEqual(destinations[0], {
      path: join(realpathSync(root), ".agents", "skills"),
      relativePath: ".agents/skills",
      selectedToolIds: ["agents", "codex", "github-copilot"],
      aliases: ["agents", "codex", "github-copilot"],
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

test("unselected escaping destinations do not block selected installs", () => {
  const outside = mkdtempSync(join(tmpdir(), "planlet-harnesses-outside-"));
  try {
    withRoot((root) => {
      mkdirSync(join(root, ".claude"));
      symlinkSync(outside, join(root, ".claude", "skills"));
      const destinations = resolveHarnessDestinations(
        root,
        normalizeToolSelector("agents"),
      );
      assert.equal(destinations.length, 1);
      assert.equal(destinations[0]!.relativePath, ".agents/skills");
      assert.deepEqual(destinations[0]!.selectedToolIds, ["agents"]);
      assert.deepEqual(destinations[0]!.aliases, [
        "agents",
        "codex",
        "github-copilot",
      ]);
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("safe unselected symlink destinations are included as aliases", () => {
  withRoot((root) => {
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(root, ".claude"));
    symlinkSync(
      join(root, ".agents", "skills"),
      join(root, ".claude", "skills"),
    );
    const destinations = resolveHarnessDestinations(
      root,
      normalizeToolSelector("claude"),
    );
    assert.equal(destinations.length, 1);
    assert.deepEqual(destinations[0]!.selectedToolIds, ["claude"]);
    assert.deepEqual(destinations[0]!.aliases, [
      "agents",
      "claude",
      "codex",
      "github-copilot",
    ]);
  });
});

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

test("harness signals detect every known repository marker", () => {
  const markers = [
    { id: "agents", path: ".agents", kind: "directory" },
    { id: "claude", path: ".claude/skills", kind: "directory" },
    { id: "claude", path: ".claude/settings.json", kind: "file" },
    { id: "claude", path: ".claude/settings.local.json", kind: "file" },
    { id: "claude", path: ".claude/agents", kind: "directory" },
    { id: "claude", path: ".claude/rules", kind: "directory" },
    { id: "claude", path: ".claude/CLAUDE.md", kind: "file" },
    { id: "claude", path: ".claude/commands", kind: "directory" },
    { id: "codex", path: ".codex", kind: "directory" },
    {
      id: "github-copilot",
      path: ".github/copilot-instructions.md",
      kind: "file",
    },
    { id: "github-copilot", path: ".github/instructions", kind: "directory" },
    { id: "github-copilot", path: ".github/skills", kind: "directory" },
    { id: "github-copilot", path: ".github/prompts", kind: "directory" },
    { id: "github-copilot", path: ".github/agents", kind: "directory" },
  ] as const;

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
  const markers = [
    { path: ".agents", kind: "directory" },
    { path: ".claude/skills", kind: "directory" },
    { path: ".claude/settings.json", kind: "file" },
    { path: ".claude/settings.local.json", kind: "file" },
    { path: ".claude/agents", kind: "directory" },
    { path: ".claude/rules", kind: "directory" },
    { path: ".claude/CLAUDE.md", kind: "file" },
    { path: ".claude/commands", kind: "directory" },
    { path: ".codex", kind: "directory" },
    { path: ".github/copilot-instructions.md", kind: "file" },
    { path: ".github/instructions", kind: "directory" },
    { path: ".github/skills", kind: "directory" },
    { path: ".github/prompts", kind: "directory" },
    { path: ".github/agents", kind: "directory" },
  ] as const;

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

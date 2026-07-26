import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  INSTALLATION_MANIFEST,
  createInstallationManifest,
  detectHarnesses,
  installHarnessSkills,
  parseInstallationManifest,
  serializeInstallationManifest,
} from "../../src/core/harness-installer.js";
import type { HarnessToolId } from "../../src/core/harnesses.js";
import {
  sha256,
  type CanonicalSkillSource,
} from "../../src/core/skill-source.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function source(files: Readonly<Record<string, string>>): CanonicalSkillSource {
  const entries = Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return Object.freeze({
    skills: Object.freeze(
      [...new Set(entries.map(([path]) => path.split("/")[0]!))].sort(),
    ),
    files: Object.freeze(
      entries.map(([relativePath, value]) => {
        const content = Buffer.from(value);
        return Object.freeze({
          skill: relativePath.split("/")[0]!,
          relativePath,
          content,
          digest: sha256(content),
        });
      }),
    ),
  });
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-installer-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const BASE_SOURCE = source({
  "planlet-example/SKILL.md": "# Example\n",
  "planlet-example/references/guide.md": "Guide\n",
});

test("manifest schema and hashes are deterministic and validated", () => {
  const manifest = createInstallationManifest(
    ["codex", "agents"] as readonly HarnessToolId[],
    BASE_SOURCE,
  );
  const serialized = serializeInstallationManifest(manifest);

  assert.deepEqual(manifest.tools, ["agents", "codex"]);
  assert.equal(serialized, serializeInstallationManifest(manifest));
  assert.deepEqual(parseInstallationManifest(serialized), manifest);
  assert.throws(
    () => parseInstallationManifest('{"schemaVersion":2}'),
    (error) => error instanceof PlanletError && error.code === "write_conflict",
  );
});

test("init coalesces shared targets, preserves unrelated skills, and is idempotent", () => {
  withRoot((root) => {
    const unrelated = join(root, ".agents", "skills", "git-commit", "SKILL.md");
    mkdirSync(join(root, ".agents", "skills", "git-commit"), {
      recursive: true,
    });
    writeFileSync(unrelated, "# Keep\n");

    const first = installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "codex,agents",
      source: BASE_SOURCE,
    });
    const second = installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents,codex",
      source: BASE_SOURCE,
    });

    assert.equal(first.destinations.length, 1);
    assert.deepEqual(first.destinations[0]?.tools, ["agents", "codex"]);
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(readFileSync(unrelated, "utf8"), "# Keep\n");
    assert.equal(
      readFileSync(
        join(root, ".agents", "skills", "planlet-example", "SKILL.md"),
        "utf8",
      ),
      "# Example\n",
    );
    assert.deepEqual(
      parseInstallationManifest(
        readFileSync(
          join(root, ".agents", "skills", INSTALLATION_MANIFEST),
          "utf8",
        ),
      ).tools,
      ["agents", "codex"],
    );
  });
});

test("init with none creates plans without resolving or installing skills", () => {
  withRoot((root) => {
    const result = installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "none",
    });

    assert.equal(result.plansInitialized, true);
    assert.deepEqual(result.destinations, []);
    assert.equal(existsSync(join(root, "plans")), true);
    assert.equal(existsSync(join(root, ".agents")), false);
  });
});

test("update adopts matching legacy trees and never creates missing targets", () => {
  withRoot((root) => {
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents",
      source: BASE_SOURCE,
    });
    const manifest = join(root, ".agents", "skills", INSTALLATION_MANIFEST);
    unlinkSync(manifest);

    const adopted = installHarnessSkills({
      repositoryRoot: root,
      operation: "update",
      tools: "agents",
      source: BASE_SOURCE,
    });
    const missing = installHarnessSkills({
      repositoryRoot: root,
      operation: "update",
      tools: "claude",
      source: BASE_SOURCE,
    });

    assert.equal(adopted.changed, true);
    assert.equal(existsSync(manifest), true);
    assert.equal(missing.destinations[0]?.state, "missing");
    assert.equal(missing.changed, false);
    assert.equal(existsSync(join(root, ".claude")), false);
  });
});

test("local and stale modifications conflict globally unless forced", () => {
  withRoot((root) => {
    const initial = source({
      "planlet-example/SKILL.md": "# Example\n",
      "planlet-example/stale.md": "Owned\n",
    });
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "all",
      source: initial,
    });
    const stale = join(
      root,
      ".agents",
      "skills",
      "planlet-example",
      "stale.md",
    );
    const claudeSkill = join(
      root,
      ".claude",
      "skills",
      "planlet-example",
      "SKILL.md",
    );
    writeFileSync(stale, "Local\n");
    const claudeBefore = readFileSync(claudeSkill);
    const updated = source({ "planlet-example/SKILL.md": "# Updated\n" });

    assert.throws(
      () =>
        installHarnessSkills({
          repositoryRoot: root,
          operation: "update",
          tools: "all",
          source: updated,
        }),
      (error) =>
        error instanceof PlanletError &&
        error.code === "write_conflict" &&
        error.message.includes("stale.md"),
    );
    assert.deepEqual(readFileSync(claudeSkill), claudeBefore);

    const forced = installHarnessSkills({
      repositoryRoot: root,
      operation: "update",
      tools: "all",
      force: true,
      source: updated,
    });
    assert.equal(forced.changed, true);
    assert.equal(existsSync(stale), false);
    assert.equal(readFileSync(claudeSkill, "utf8"), "# Updated\n");
  });
});

test("tool detection reports shared physical state without mutation", () => {
  withRoot((root) => {
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents",
      source: BASE_SOURCE,
    });
    const skill = join(
      root,
      ".agents",
      "skills",
      "planlet-example",
      "SKILL.md",
    );
    writeFileSync(skill, "Local\n");

    const detected = detectHarnesses({
      repositoryRoot: root,
      source: BASE_SOURCE,
    });
    assert.deepEqual(
      detected.map(({ id, state }) => ({ id, state })),
      [
        { id: "agents", state: "modified" },
        { id: "claude", state: "missing" },
        { id: "codex", state: "modified" },
      ],
    );
    assert.equal(readFileSync(skill, "utf8"), "Local\n");
  });
});

test("tool detection coalesces in-repository symlink destinations", () => {
  withRoot((root) => {
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(root, ".claude"));
    symlinkSync(
      join(root, ".agents", "skills"),
      join(root, ".claude", "skills"),
    );
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      source: BASE_SOURCE,
    });

    assert.deepEqual(
      detectHarnesses({ repositoryRoot: root, source: BASE_SOURCE }).map(
        ({ id, state }) => ({ id, state }),
      ),
      [
        { id: "agents", state: "installed" },
        { id: "claude", state: "installed" },
        { id: "codex", state: "installed" },
      ],
    );
  });
});

test("tool detection classifies malformed manifests as modified", () => {
  withRoot((root) => {
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents",
      source: BASE_SOURCE,
    });
    writeFileSync(
      join(root, ".agents", "skills", INSTALLATION_MANIFEST),
      "invalid\n",
    );

    assert.deepEqual(
      detectHarnesses({ repositoryRoot: root, source: BASE_SOURCE })
        .filter(({ id }) => id === "agents" || id === "codex")
        .map(({ id, state }) => ({ id, state })),
      [
        { id: "agents", state: "modified" },
        { id: "codex", state: "modified" },
      ],
    );
  });
});

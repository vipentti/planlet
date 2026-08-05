import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  INSTALLATION_MANIFEST,
  createInstallationManifest,
  detectHarnesses,
  installHarnessSkills,
  parseInstallationManifest,
  serializeInstallationManifest,
} from "../../src/core/harness-installer.js";
import {
  HARNESS_INSTALL_LOCK_NAME,
  planletLockRoot,
} from "../../src/core/planlet-lock.js";
import {
  sha256,
  type CanonicalSkillSource,
} from "../../src/core/skill-source.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function source(files: Readonly<Record<string, string>>): CanonicalSkillSource {
  const entries = Object.entries(files).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
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
    rmSync(planletLockRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

const BASE_SOURCE = source({
  "planlet-example/SKILL.md": "# Example\n",
  "planlet-example/references/guide.md": "Guide\n",
});

test("manifest schema and hashes are deterministic and validated", () => {
  const manifest = createInstallationManifest(BASE_SOURCE);
  const serialized = serializeInstallationManifest(manifest);

  assert.deepEqual(manifest, {
    schemaVersion: 2,
    files: Object.fromEntries(
      BASE_SOURCE.files.map((file) => [file.relativePath, file.digest]),
    ),
  });
  assert.equal(serialized, serializeInstallationManifest(manifest));
  assert.deepEqual(parseInstallationManifest(serialized), manifest);
  assert.equal(serialized.includes('"tools"'), false);
  for (const invalid of [
    '{"schemaVersion":2}',
    '{"schemaVersion":1,"tools":["agents"],"files":{}}',
    '{"schemaVersion":1,"files":{}}',
    '{"schemaVersion":2,"tools":["agents"],"files":{}}',
    '{"schemaVersion":2,"tools":[],"files":{}}',
    '{"schemaVersion":3,"files":{}}',
    '{"schemaVersion":2,"files":[]}',
    '{"schemaVersion":2,"files":{"planlet-example/SKILL.md":1}}',
  ]) {
    assert.throws(
      () => parseInstallationManifest(invalid),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
      invalid,
    );
  }
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

    assert.equal(first.data.destinations.length, 1);
    assert.deepEqual(first.data.destinations[0]?.tools, ["agents", "codex"]);
    assert.equal(first.data.changed, true);
    assert.equal(second.data.changed, false);
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
      ),
      createInstallationManifest(BASE_SOURCE),
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

    assert.equal(result.data.plansInitialized, true);
    assert.deepEqual(result.data.destinations, []);
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

    assert.equal(adopted.data.changed, true);
    assert.equal(existsSync(manifest), true);
    assert.equal(missing.data.destinations[0]?.state, "missing");
    assert.equal(missing.data.changed, false);
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
    assert.equal(forced.data.changed, true);
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
    const manifestPath = join(root, ".agents", "skills", INSTALLATION_MANIFEST);
    const expected = [
      { id: "agents", state: "modified" },
      { id: "codex", state: "modified" },
    ];
    for (const manifestText of [
      "invalid\n",
      '{"schemaVersion":1,"tools":["agents"],"files":{}}',
    ]) {
      writeFileSync(manifestPath, manifestText);
      assert.deepEqual(
        detectHarnesses({ repositoryRoot: root, source: BASE_SOURCE })
          .filter(({ id }) => id === "agents" || id === "codex")
          .map(({ id, state }) => ({ id, state })),
        expected,
      );
    }
  });
});

function snapshotDestination(root: string): Record<string, string> {
  const destination = join(root, ".agents", "skills");
  const entries: Record<string, string> = {};
  const visit = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(path).isDirectory()) visit(path, relative);
      else entries[relative] = readFileSync(path, "utf8");
    }
  };
  if (existsSync(destination)) visit(destination, "");
  return entries;
}

test("destination install rolls back to the exact pre-operation state on faults", () => {
  withRoot((root) => {
    const initial = source({
      "planlet-old/SKILL.md": "# Old\n",
      "planlet-example/SKILL.md": "# Example\n",
    });
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents",
      source: initial,
    });
    const unrelated = join(root, ".agents", "skills", "git-commit", "SKILL.md");
    mkdirSync(join(root, ".agents", "skills", "git-commit"), {
      recursive: true,
    });
    writeFileSync(unrelated, "# Keep\n");
    const before = snapshotDestination(root);
    const updated = source({
      "planlet-example/SKILL.md": "# Updated\n",
      "planlet-new/SKILL.md": "# New\n",
    });

    const fault = (step: string, detail?: string) => {
      assert.throws(
        () =>
          installHarnessSkills({
            repositoryRoot: root,
            operation: "update",
            tools: "agents",
            force: true,
            source: updated,
            transactionHooks: {
              onStep: (current, currentDetail) => {
                if (
                  current === step &&
                  (detail === undefined || currentDetail === detail)
                ) {
                  throw new Error(`fail at ${step}`);
                }
              },
            },
          }),
        (error) =>
          error instanceof PlanletError && error.code === "write_conflict",
      );
      assert.deepEqual(snapshotDestination(root), before);
      assert.equal(readFileSync(unrelated, "utf8"), "# Keep\n");
    };

    // One pre-commit fault is enough: every step before the commit point funnels
    // into the same rollback. Faulting on the first of two skills also leaves a
    // partial `mutated` set, which is the only variation that changes behavior.
    fault("afterReplaceSkill", "planlet-example");

    assert.throws(
      () =>
        installHarnessSkills({
          repositoryRoot: root,
          operation: "update",
          tools: "agents",
          force: true,
          source: updated,
          transactionHooks: {
            onStep: (step) => {
              if (step === "afterReplaceSkill") {
                throw new Error("fail before commit for rollback hook");
              }
              if (step === "duringRollback") {
                throw new Error("fail during rollback");
              }
            },
          },
        }),
      (error) => {
        if (
          !(error instanceof PlanletError) ||
          error.code !== "write_conflict"
        ) {
          return false;
        }
        assert.equal(error.details.rollbackFailed, true);
        assert.equal(error.details.manifestPublished, false);
        assert.equal(typeof error.details.backupPath, "string");
        assert.equal(typeof error.details.stagePath, "string");
        assert.equal(error.details.next, undefined);
        assert.match(String(error.next), /Do not delete/);
        assert.ok(Array.isArray(error.details.mutated));
        assert.ok(existsSync(String(error.details.backupPath)));
        assert.ok(existsSync(String(error.details.stagePath)));

        const structured = error.toStructuredError();
        assert.match(String(structured.next), /Do not delete/);
        assert.equal(
          (structured.details as { next?: unknown }).next,
          undefined,
        );

        const destination = join(root, ".agents", "skills");
        for (const [relativePath, content] of Object.entries(before)) {
          const live = join(destination, relativePath);
          const backup = join(String(error.details.backupPath), relativePath);
          const liveOk =
            existsSync(live) && readFileSync(live, "utf8") === content;
          const backupOk =
            existsSync(backup) && readFileSync(backup, "utf8") === content;
          assert.ok(
            liveOk || backupOk,
            `${relativePath} missing from live and backup`,
          );
        }
        assert.equal(readFileSync(unrelated, "utf8"), "# Keep\n");
        return true;
      },
    );

    assert.throws(
      () =>
        installHarnessSkills({
          repositoryRoot: root,
          operation: "update",
          tools: "agents",
          force: true,
          source: updated,
        }),
      (error) =>
        error instanceof PlanletError &&
        error.code === "write_conflict" &&
        Array.isArray(error.details.leftoverPaths) &&
        error.details.next === undefined &&
        typeof error.next === "string" &&
        error.next.includes("Inspect leftover") &&
        error.toStructuredError().next === error.next,
    );

    const destination = join(root, ".agents", "skills");
    for (const name of readdirSync(destination)) {
      if (name.startsWith(".planlet-bak-") || name.startsWith(".planlet-tx-")) {
        rmSync(join(destination, name), { recursive: true, force: true });
      }
    }
    for (const name of readdirSync(destination)) {
      if (name.startsWith("planlet-") || name === INSTALLATION_MANIFEST) {
        rmSync(join(destination, name), { recursive: true, force: true });
      }
    }
    // Restore exact pre-op managed state from the earlier snapshot before retry.
    for (const [relativePath, content] of Object.entries(before)) {
      const target = join(destination, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    const published = installHarnessSkills({
      repositoryRoot: root,
      operation: "update",
      tools: "agents",
      force: true,
      source: updated,
    });
    assert.equal(published.data.changed, true);
    assert.equal(
      readFileSync(
        join(root, ".agents", "skills", "planlet-example", "SKILL.md"),
        "utf8",
      ),
      "# Updated\n",
    );
    assert.equal(
      existsSync(join(root, ".agents", "skills", "planlet-old")),
      false,
    );
    assert.equal(readFileSync(unrelated, "utf8"), "# Keep\n");
  });
});

test("rollback failure after one skill and while restoring manifest leaves recovery dirs", () => {
  withRoot((root) => {
    const initial = source({
      "planlet-old/SKILL.md": "# Old\n",
      "planlet-example/SKILL.md": "# Example\n",
    });
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents",
      source: initial,
    });
    const before = snapshotDestination(root);
    const updated = source({
      "planlet-example/SKILL.md": "# Updated\n",
      "planlet-new/SKILL.md": "# New\n",
    });

    const failDuring = (matchDetail: string | undefined, which: number) => {
      let seen = 0;
      assert.throws(
        () =>
          installHarnessSkills({
            repositoryRoot: root,
            operation: "update",
            tools: "agents",
            force: true,
            source: updated,
            transactionHooks: {
              onStep: (step, detail) => {
                if (step === "afterReplaceSkill") {
                  throw new Error("fail before manifest");
                }
                if (
                  step === "duringRollback" &&
                  (matchDetail === undefined || detail === matchDetail)
                ) {
                  seen += 1;
                  if (seen === which) {
                    throw new Error(`fail rollback ${detail ?? ""}`);
                  }
                }
              },
            },
          }),
        (error) => {
          if (
            !(error instanceof PlanletError) ||
            error.code !== "write_conflict"
          ) {
            return false;
          }
          assert.equal(error.details.rollbackFailed, true);
          assert.ok(existsSync(String(error.details.backupPath)));
          for (const [relativePath, content] of Object.entries(before)) {
            const live = join(root, ".agents", "skills", relativePath);
            const backup = join(String(error.details.backupPath), relativePath);
            const liveOk =
              existsSync(live) && readFileSync(live, "utf8") === content;
            const backupOk =
              existsSync(backup) && readFileSync(backup, "utf8") === content;
            assert.ok(liveOk || backupOk, relativePath);
          }
          return true;
        },
      );

      const destination = join(root, ".agents", "skills");
      for (const name of readdirSync(destination)) {
        if (
          name.startsWith(".planlet-bak-") ||
          name.startsWith(".planlet-tx-")
        ) {
          rmSync(join(destination, name), { recursive: true, force: true });
        }
      }
      for (const name of readdirSync(destination)) {
        if (name.startsWith("planlet-") || name === INSTALLATION_MANIFEST) {
          rmSync(join(destination, name), { recursive: true, force: true });
        }
      }
      for (const [relativePath, content] of Object.entries(before)) {
        const target = join(destination, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
    };

    failDuring(undefined, 1);
    failDuring(undefined, 2);
    failDuring(INSTALLATION_MANIFEST, 1);
  });
});

// The one nested-install test. The lock wraps the whole operation, so nesting at
// a second step proves nothing extra; a coalesced destination does, because it
// shows the lock is repository-wide rather than per-destination.
test("nested claude install against coalesced agents destination cannot mutate winner", () => {
  withRoot((root) => {
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(root, ".claude"));
    symlinkSync(
      join(root, ".agents", "skills"),
      join(root, ".claude", "skills"),
    );
    const initial = source({
      "planlet-example/SKILL.md": "# Example\n",
    });
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents",
      source: initial,
    });

    const winnerSource = source({
      "planlet-example/SKILL.md": "# AgentsWinner\n",
    });
    const result = installHarnessSkills({
      repositoryRoot: root,
      operation: "update",
      tools: "agents",
      force: true,
      source: winnerSource,
      transactionHooks: {
        onStep: (step) => {
          if (step !== "afterReplaceSkill") return;
          assert.throws(
            () =>
              installHarnessSkills({
                repositoryRoot: root,
                operation: "update",
                tools: "claude",
                force: true,
                source: source({
                  "planlet-example/SKILL.md": "# ClaudeLoser\n",
                }),
              }),
            (error) =>
              error instanceof PlanletError && error.code === "write_conflict",
          );
        },
      },
    });
    assert.equal(result.data.changed, true);
    assert.equal(
      readFileSync(
        join(root, ".agents", "skills", "planlet-example", "SKILL.md"),
        "utf8",
      ),
      "# AgentsWinner\n",
    );
    assert.equal(
      existsSync(join(planletLockRoot(root), HARNESS_INSTALL_LOCK_NAME)),
      false,
    );
  });
});

test("harness lock is released after install failure", () => {
  withRoot((root) => {
    assert.throws(
      () =>
        installHarnessSkills({
          repositoryRoot: root,
          operation: "init",
          tools: "agents",
          source: source({
            "planlet-example/SKILL.md": "# Example\n",
          }),
          transactionHooks: {
            onStep: (step) => {
              if (step === "afterReplaceSkill") {
                throw new Error("boom");
              }
            },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );
    assert.equal(
      existsSync(join(planletLockRoot(root), HARNESS_INSTALL_LOCK_NAME)),
      false,
    );
  });
});

test("post-commit cleanup failure preserves published skills and leaves backup", () => {
  withRoot((root) => {
    const initial = source({
      "planlet-example/SKILL.md": "# Example\n",
    });
    installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "agents",
      source: initial,
    });
    const unrelated = join(root, ".agents", "skills", "git-commit", "SKILL.md");
    mkdirSync(join(root, ".agents", "skills", "git-commit"), {
      recursive: true,
    });
    writeFileSync(unrelated, "# Keep\n");

    const updated = source({
      "planlet-example/SKILL.md": "# Updated\n",
      "planlet-new/SKILL.md": "# New\n",
    });

    const result = installHarnessSkills({
      repositoryRoot: root,
      operation: "update",
      tools: "agents",
      force: true,
      source: updated,
      transactionHooks: {
        onStep: (step) => {
          if (step !== "beforeCleanup") return;
          const destination = join(root, ".agents", "skills");
          const backup = readdirSync(destination).find((name) =>
            name.startsWith(".planlet-bak-"),
          );
          assert.ok(backup);
          // Simulate partial backup deletion before cleanup fails.
          rmSync(join(destination, backup, "planlet-example"), {
            recursive: true,
            force: true,
          });
          throw new Error("fail deleting leftover backup");
        },
      },
    });

    assert.equal(result.data.changed, true);
    assert.equal(
      readFileSync(
        join(root, ".agents", "skills", "planlet-example", "SKILL.md"),
        "utf8",
      ),
      "# Updated\n",
    );
    assert.equal(
      readFileSync(
        join(root, ".agents", "skills", "planlet-new", "SKILL.md"),
        "utf8",
      ),
      "# New\n",
    );
    assert.equal(readFileSync(unrelated, "utf8"), "# Keep\n");
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes("cleanup was incomplete"),
      ),
    );
    assert.ok(
      readdirSync(join(root, ".agents", "skills")).some((name) =>
        name.startsWith(".planlet-bak-"),
      ),
    );
  });
});

test("safe symlink coalesces unselected aliases for selected-only init", () => {
  withRoot((root) => {
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(root, ".claude"));
    symlinkSync(
      join(root, ".agents", "skills"),
      join(root, ".claude", "skills"),
    );

    const installed = installHarnessSkills({
      repositoryRoot: root,
      operation: "init",
      tools: "claude",
      source: BASE_SOURCE,
    });
    assert.equal(installed.data.changed, true);
    const manifest = parseInstallationManifest(
      readFileSync(
        join(root, ".claude", "skills", INSTALLATION_MANIFEST),
        "utf8",
      ),
    );
    assert.deepEqual(manifest, createInstallationManifest(BASE_SOURCE));
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

    const updated = installHarnessSkills({
      repositoryRoot: root,
      operation: "update",
      tools: "agents",
      source: BASE_SOURCE,
    });
    assert.equal(updated.data.changed, false);
    assert.deepEqual(
      parseInstallationManifest(
        readFileSync(
          join(root, ".agents", "skills", INSTALLATION_MANIFEST),
          "utf8",
        ),
      ),
      createInstallationManifest(BASE_SOURCE),
    );
  });
});

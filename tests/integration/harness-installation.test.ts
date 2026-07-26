import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decode } from "@toon-format/toon";

import { main, type CliRuntime } from "../../src/cli.js";
import {
  INSTALLATION_MANIFEST,
  parseInstallationManifest,
  serializeInstallationManifest,
} from "../../src/core/harness-installer.js";
import {
  enumerateCanonicalSkills,
  sha256,
} from "../../src/core/skill-source.js";

interface Invocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function invoke(root: string, arguments_: readonly string[]): Invocation {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runtime: CliRuntime = {
    cwd: root,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    clock: () => new Date("2028-03-04T05:06:07Z"),
  };
  return {
    exitCode: main(["--root", root, ...arguments_], runtime),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

function decodedRecord(output: string): Record<string, unknown> {
  return record(decode(output.trimEnd()));
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-install-command-"));
  mkdirSync(join(root, ".git"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("init parses selectors, preserves unrelated skills, and installs canonical bytes once", () => {
  withRoot((root) => {
    const unrelated = join(root, ".agents", "skills", "git-commit", "SKILL.md");
    mkdirSync(join(root, ".agents", "skills", "git-commit"), {
      recursive: true,
    });
    writeFileSync(unrelated, "# Keep\n");

    const result = invoke(root, ["init", "--tools", "codex,agents"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = decodedRecord(result.stdout);
    assert.ok(Array.isArray(output.destinations));
    const firstDestination = record(output.destinations[0]);
    assert.deepEqual(firstDestination.tools, ["agents", "codex"]);
    assert.equal(firstDestination.changed, true);
    assert.equal(existsSync(join(root, "plans")), true);
    assert.equal(existsSync(join(root, ".claude")), false);
    assert.equal(readFileSync(unrelated, "utf8"), "# Keep\n");

    const canonical = enumerateCanonicalSkills();
    for (const file of canonical.files) {
      assert.deepEqual(
        readFileSync(join(root, ".agents", "skills", file.relativePath)),
        file.content,
        file.relativePath,
      );
    }

    const repeated = invoke(root, ["init", "--tools", "agents,codex"]);
    assert.equal(repeated.exitCode, 0, repeated.stderr);
    assert.equal(decodedRecord(repeated.stdout).changed, false);
  });
});

test("invalid selectors fail before plans or harness mutation", () => {
  for (const selector of ["", "agents,none", "gemini"]) {
    withRoot((root) => {
      const result = invoke(root, ["init", "--tools", selector]);
      assert.equal(result.exitCode, 2, selector);
      assert.match(result.stderr, /code: unsupported_tool/);
      assert.equal(existsSync(join(root, "plans")), false);
      assert.equal(existsSync(join(root, ".agents")), false);
      assert.equal(existsSync(join(root, ".claude")), false);
    });
  }
});

test("update adopts legacy files, skips missing destinations, and removes owned stale files", () => {
  withRoot((root) => {
    assert.equal(invoke(root, ["init", "--tools", "agents"]).exitCode, 0);
    const destination = join(root, ".agents", "skills");
    const manifestPath = join(destination, INSTALLATION_MANIFEST);
    unlinkSync(manifestPath);

    const adopted = invoke(root, ["update", "--tools", "agents"]);
    assert.equal(adopted.exitCode, 0, adopted.stderr);
    assert.equal(existsSync(manifestPath), true);

    const stalePath = join(destination, "planlet-plan", "stale.txt");
    writeFileSync(stalePath, "Owned stale\n");
    const manifest = parseInstallationManifest(
      readFileSync(manifestPath, "utf8"),
      manifestPath,
    );
    const staleManifest = {
      ...manifest,
      files: {
        ...manifest.files,
        "planlet-plan/stale.txt": sha256(Buffer.from("Owned stale\n")),
      },
    };
    writeFileSync(manifestPath, serializeInstallationManifest(staleManifest));

    const refreshed = invoke(root, ["update", "--tools", "agents"]);
    assert.equal(refreshed.exitCode, 0, refreshed.stderr);
    assert.equal(existsSync(stalePath), false);

    const missing = invoke(root, ["update", "--tools", "claude"]);
    assert.equal(missing.exitCode, 0, missing.stderr);
    assert.equal(existsSync(join(root, ".claude")), false);
    const missingOutput = decodedRecord(missing.stdout);
    assert.ok(Array.isArray(missingOutput.destinations));
    assert.equal(record(missingOutput.destinations[0]).state, "missing");
  });
});

test("cross-destination conflicts preflight all writes and force restores parity", () => {
  withRoot((root) => {
    assert.equal(invoke(root, ["init"]).exitCode, 0);
    const agentsSkill = join(
      root,
      ".agents",
      "skills",
      "planlet-implement",
      "SKILL.md",
    );
    const claudeManifest = join(
      root,
      ".claude",
      "skills",
      INSTALLATION_MANIFEST,
    );
    const claudeBefore = readFileSync(claudeManifest);
    writeFileSync(agentsSkill, "Local edit\n");

    const failed = invoke(root, ["update"]);
    assert.equal(failed.exitCode, 5);
    assert.match(failed.stderr, /code: write_conflict/);
    assert.match(failed.stderr, /planlet-implement\/SKILL.md/);
    assert.deepEqual(readFileSync(claudeManifest), claudeBefore);

    const forced = invoke(root, ["update", "--force"]);
    assert.equal(forced.exitCode, 0, forced.stderr);
    const canonical = enumerateCanonicalSkills();
    const expected = canonical.files.find(
      (file) => file.relativePath === "planlet-implement/SKILL.md",
    )!;
    assert.deepEqual(readFileSync(agentsSkill), expected.content);

    const tools = invoke(root, ["tools"]);
    assert.equal(tools.exitCode, 0, tools.stderr);
    const toolsOutput = decodedRecord(tools.stdout);
    assert.ok(Array.isArray(toolsOutput.tools));
    assert.deepEqual(
      toolsOutput.tools.map((value) => {
        const tool = record(value);
        return { id: tool.id, state: tool.state };
      }),
      [
        { id: "agents", state: "installed" },
        { id: "claude", state: "installed" },
        { id: "codex", state: "installed" },
      ],
    );
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

import { decode } from "@toon-format/toon";

import { renderAgentsSection } from "../../src/core/agent-snippet.js";
import {
  buildToolChoices,
  main,
  resolveAnswer,
  type CliRuntime,
} from "../../src/cli.js";
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

async function invoke(
  root: string,
  arguments_: readonly string[],
): Promise<Invocation> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runtime: CliRuntime = {
    cwd: root,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    clock: () => new Date("2028-03-04T05:06:07Z"),
  };
  return {
    exitCode: await main(["--root", root, ...arguments_], runtime),
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

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "planlet-install-command-"));
  mkdirSync(join(root, ".git"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function withGitRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "planlet-install-git-"));
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function stagedFiles(root: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("A "))
    .map((line) => line.slice(3));
}

test("init parses selectors, preserves unrelated skills, and installs canonical bytes once", async () => {
  await withRoot(async (root) => {
    const unrelated = join(root, ".agents", "skills", "git-commit", "SKILL.md");
    mkdirSync(join(root, ".agents", "skills", "git-commit"), {
      recursive: true,
    });
    writeFileSync(unrelated, "# Keep\n");

    const result = await invoke(root, [
      "init",
      "--tools",
      "codex,agents,github-copilot",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = decodedRecord(result.stdout);
    assert.ok(Array.isArray(output.destinations));
    const firstDestination = record(output.destinations[0]);
    assert.deepEqual(firstDestination.tools, [
      "agents",
      "codex",
      "github-copilot",
    ]);
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

    const repeated = await invoke(root, ["init", "--tools", "agents,codex"]);
    assert.equal(repeated.exitCode, 0, repeated.stderr);
    assert.equal(decodedRecord(repeated.stdout).changed, false);
  });
});

test("explicit Copilot init keeps existing .github skills untouched", async () => {
  await withRoot(async (root) => {
    const existing = join(root, ".github", "skills", "user-skill", "SKILL.md");
    mkdirSync(join(root, ".github", "skills", "user-skill"), {
      recursive: true,
    });
    writeFileSync(existing, "# User skill\n");

    const result = await invoke(root, ["init", "--tools", "github-copilot"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = decodedRecord(result.stdout);
    assert.ok(Array.isArray(output.destinations));
    const destination = record(output.destinations[0]);
    assert.equal(destination.destination, ".agents/skills");
    assert.deepEqual(destination.tools, ["github-copilot"]);
    assert.equal(readFileSync(existing, "utf8"), "# User skill\n");
    assert.equal(existsSync(join(root, ".agents", "skills")), true);
    assert.equal(existsSync(join(root, ".claude")), false);
  });
});

test("init writes and stages AGENTS.md and a regular CLAUDE.md in git repositories", async () => {
  await withGitRoot(async (root) => {
    writeFileSync(join(root, "CLAUDE.md"), "# Claude\n");

    const result = await invoke(root, ["init", "--tools", "none"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = decodedRecord(result.stdout);
    assert.deepEqual(output.agentFiles, {
      "AGENTS.md": "added",
      "CLAUDE.md": "updated",
    });
    assert.equal(output.changed, true);
    assert.equal(output.plansInitialized, true);
    assert.equal(
      readFileSync(join(root, "AGENTS.md"), "utf8"),
      renderAgentsSection(),
    );
    assert.equal(
      readFileSync(join(root, "CLAUDE.md"), "utf8"),
      `# Claude\n\n${renderAgentsSection()}`,
    );
    assert.deepEqual(stagedFiles(root).sort(), ["AGENTS.md", "CLAUDE.md"]);
  });
});

test("--no-agents leaves AGENTS.md and CLAUDE.md untouched", async () => {
  await withGitRoot(async (root) => {
    writeFileSync(join(root, "CLAUDE.md"), "# Claude\n");

    const result = await invoke(root, [
      "init",
      "--tools",
      "none",
      "--no-agents",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(decodedRecord(result.stdout).agentFiles, {
      "AGENTS.md": "skipped",
      "CLAUDE.md": "skipped",
    });
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# Claude\n");
    assert.deepEqual(stagedFiles(root), []);
  });
});

test("update refuses --no-agents and refreshes present markers only", async () => {
  await withGitRoot(async (root) => {
    const rejected = await invoke(root, ["update", "--no-agents"]);
    assert.equal(rejected.exitCode, 2);
    assert.match(rejected.stderr, /^usage:/);

    const untouched = await invoke(root, ["update"]);
    assert.equal(untouched.exitCode, 0, untouched.stderr);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);

    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(
      agentsPath,
      `# Project\n\n<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\nstale\n<!-- END PLANLET AGENTS -->\n`,
    );
    const refreshed = await invoke(root, ["update"]);
    assert.equal(refreshed.exitCode, 0, refreshed.stderr);
    const refreshedOutput = decodedRecord(refreshed.stdout);
    const refreshedFiles = record(refreshedOutput.agentFiles);
    assert.equal(refreshedFiles["AGENTS.md"], "updated");
    assert.equal(
      readFileSync(agentsPath, "utf8"),
      `# Project\n\n${renderAgentsSection()}`,
    );

    const fresh = await invoke(root, ["update"]);
    assert.equal(fresh.exitCode, 0, fresh.stderr);
    const freshOutput = decodedRecord(fresh.stdout);
    assert.equal(record(freshOutput.agentFiles)["AGENTS.md"], "unchanged");
    assert.equal(freshOutput.changed, false);
  });
});

test("invalid selectors fail before plans or harness mutation", async () => {
  for (const selector of ["", "agents,none", "gemini"]) {
    await withRoot(async (root) => {
      const result = await invoke(root, ["init", "--tools", selector]);
      assert.equal(result.exitCode, 2, selector);
      assert.match(result.stderr, /code: unsupported_tool/);
      assert.equal(existsSync(join(root, "plans")), false);
      assert.equal(existsSync(join(root, ".agents")), false);
      assert.equal(existsSync(join(root, ".claude")), false);
    });
  }
});

test("update adopts legacy files, skips missing destinations, and removes owned stale files", async () => {
  await withRoot(async (root) => {
    assert.equal(
      (await invoke(root, ["init", "--tools", "agents"])).exitCode,
      0,
    );
    const destination = join(root, ".agents", "skills");
    const manifestPath = join(destination, INSTALLATION_MANIFEST);
    unlinkSync(manifestPath);

    const adopted = await invoke(root, ["update", "--tools", "agents"]);
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

    const refreshed = await invoke(root, ["update", "--tools", "agents"]);
    assert.equal(refreshed.exitCode, 0, refreshed.stderr);
    assert.equal(existsSync(stalePath), false);

    const missing = await invoke(root, ["update", "--tools", "claude"]);
    assert.equal(missing.exitCode, 0, missing.stderr);
    assert.equal(existsSync(join(root, ".claude")), false);
    const missingOutput = decodedRecord(missing.stdout);
    assert.ok(Array.isArray(missingOutput.destinations));
    assert.equal(record(missingOutput.destinations[0]).state, "missing");
  });
});

test("cross-destination conflicts preflight all writes and force restores parity", async () => {
  await withRoot(async (root) => {
    assert.equal((await invoke(root, ["init"])).exitCode, 0);
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

    const failed = await invoke(root, ["update"]);
    assert.equal(failed.exitCode, 5);
    assert.match(failed.stderr, /code: write_conflict/);
    assert.match(failed.stderr, /planlet-implement\/SKILL.md/);
    assert.deepEqual(readFileSync(claudeManifest), claudeBefore);

    const forced = await invoke(root, ["update", "--force"]);
    assert.equal(forced.exitCode, 0, forced.stderr);
    const canonical = enumerateCanonicalSkills();
    const expected = canonical.files.find(
      (file) => file.relativePath === "planlet-implement/SKILL.md",
    )!;
    assert.deepEqual(readFileSync(agentsSkill), expected.content);

    const tools = await invoke(root, ["tools"]);
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
        { id: "github-copilot", state: "installed" },
      ],
    );
  });
});

test("prompt choices collapse shared destinations and default to populated ones", async () => {
  await withRoot(async (root) => {
    mkdirSync(join(root, ".claude", "skills", "unrelated"), {
      recursive: true,
    });
    writeFileSync(
      join(root, ".claude", "skills", "unrelated", "SKILL.md"),
      "# Unrelated\n",
    );

    const choices = buildToolChoices(root);
    assert.deepEqual(
      choices.map((choice) => ({
        selector: choice.selector,
        destination: choice.destination,
        names: choice.names,
        preselected: choice.preselected,
      })),
      [
        {
          selector: "agents,codex,github-copilot",
          destination: ".agents/skills",
          names: "Generic Agent Skills, Codex, GitHub Copilot",
          preselected: false,
        },
        {
          selector: "claude",
          destination: ".claude/skills",
          names: "Claude Code",
          preselected: true,
        },
      ],
    );
    assert.equal(resolveAnswer(choices, ""), "claude");
  });
});

test("prompt choices use harness markers and ignore Planlet-only skills", async () => {
  await withRoot(async (root) => {
    mkdirSync(join(root, ".github", "skills"), { recursive: true });
    mkdirSync(join(root, ".codex"), { recursive: true });
    mkdirSync(join(root, ".claude", "skills", "planlet-example"), {
      recursive: true,
    });
    writeFileSync(
      join(root, ".claude", "skills", INSTALLATION_MANIFEST),
      "{}\n",
    );

    const choices = buildToolChoices(root);
    assert.deepEqual(
      choices.map((choice) => choice.preselected),
      [true, false],
    );
    assert.equal(resolveAnswer(choices, ""), "agents,codex,github-copilot");
  });
});

test("prompt choices detect per-machine Claude settings marker", async () => {
  await withRoot(async (root) => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.local.json"), "{}\n");

    const choices = buildToolChoices(root);
    assert.deepEqual(
      choices.map((choice) => choice.preselected),
      [false, true],
    );
    assert.equal(resolveAnswer(choices, ""), "claude");
  });
});

test("prompt choices combine Copilot and Claude markers", async () => {
  await withRoot(async (root) => {
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(
      join(root, ".github", "copilot-instructions.md"),
      "Use Copilot\n",
    );
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "agents", "reviewer.md"),
      "Review changes\n",
    );

    const choices = buildToolChoices(root);
    assert.deepEqual(
      choices.map((choice) => choice.preselected),
      [true, true],
    );
    assert.equal(
      resolveAnswer(choices, ""),
      "agents,codex,github-copilot,claude",
    );
  });
});

test("prompt choices preselect everything when no destination exists", async () => {
  await withRoot(async (root) => {
    const choices = buildToolChoices(root);
    assert.deepEqual(
      choices.map((choice) => choice.preselected),
      [true, true],
    );
    assert.equal(
      resolveAnswer(choices, ""),
      "agents,codex,github-copilot,claude",
    );
  });
});

test("prompt choices coalesce symlinked destinations and survive a file destination", async () => {
  await withRoot(async (root) => {
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(root, ".claude"));
    symlinkSync(
      join(root, ".agents", "skills"),
      join(root, ".claude", "skills"),
      "dir",
    );
    assert.deepEqual(
      buildToolChoices(root).map((choice) => choice.selector),
      ["agents,claude,codex,github-copilot"],
    );
  });

  await withRoot(async (root) => {
    mkdirSync(join(root, ".agents"));
    writeFileSync(join(root, ".agents", "skills"), "not a directory\n");
    assert.deepEqual(
      buildToolChoices(root).map((choice) => choice.state),
      ["modified", "missing"],
    );
    const result = await invoke(root, ["init", "--tools", "agents"]);
    assert.equal(result.exitCode, 5);
    assert.match(result.stderr, /code: write_conflict/);
  });
});

test("conflicting destinations reject before agents files are written or staged", async () => {
  await withGitRoot(async (root) => {
    mkdirSync(join(root, ".agents"));
    writeFileSync(join(root, ".agents", "skills"), "not a directory\n");

    const result = await invoke(root, ["init", "--tools", "agents"]);
    assert.equal(result.exitCode, 5);
    assert.match(result.stderr, /code: write_conflict/);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
    assert.equal(existsSync(join(root, "CLAUDE.md")), false);
    assert.equal(existsSync(join(root, "plans")), false);
    assert.deepEqual(stagedFiles(root), []);
  });
});

test("prompt answers map to selectors and reject unrecognized input", async () => {
  await withRoot(async (root) => {
    const choices = buildToolChoices(root);
    assert.equal(resolveAnswer(choices, "none"), "none");
    assert.equal(resolveAnswer(choices, " 2 "), "claude");
    assert.equal(
      resolveAnswer(choices, "1,2"),
      "agents,codex,github-copilot,claude",
    );
    for (const answer of ["0", "3", "y", "1,x", "1.5"]) {
      assert.equal(resolveAnswer(choices, answer), undefined, answer);
    }
  });
});

test("an interactive init that cannot resolve a destination exits with unsafe_path", async () => {
  await withRoot(async (root) => {
    // A skill directory symlinked outside the repository must fail through the
    // awaited dispatch as structured output, not as a rejected main promise.
    mkdirSync(join(root, ".claude"));
    const outside = mkdtempSync(join(tmpdir(), "planlet-outside-"));
    symlinkSync(outside, join(root, ".claude", "skills"), "dir");
    const previousIn = process.stdin.isTTY;
    const previousOut = process.stdout.isTTY;
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    try {
      const result = await invoke(root, ["init"]);
      assert.equal(result.exitCode, 5);
      assert.match(result.stderr, /code: unsafe_path/);
    } finally {
      process.stdin.isTTY = previousIn;
      process.stdout.isTTY = previousOut;
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

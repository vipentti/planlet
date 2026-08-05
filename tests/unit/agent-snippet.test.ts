import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_SNIPPET,
  renderAgentsSection,
  updateAgentFiles,
} from "../../src/core/agent-snippet.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-agents-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("snippet source is shared and section rendering is deterministic", () => {
  assert.match(AGENT_SNIPPET, /^## Planning with Planlet\n/);
  assert.match(AGENT_SNIPPET, /stop and say so\. Do not hand-create\n/);

  const section = renderAgentsSection();
  assert.match(
    section,
    /^<!-- BEGIN PLANLET AGENTS v:1 hash:[0-9a-f]{8} -->\n/,
  );
  assert.ok(section.includes(`\n${AGENT_SNIPPET}\n`));
  assert.ok(section.endsWith("<!-- END PLANLET AGENTS -->\n"));
  assert.equal(section, renderAgentsSection());
});

test("README quotes the CLI-owned snippet exactly", () => {
  const readme = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "README.md"),
    "utf8",
  );
  const quote = readme.match(
    /## Agent onboarding\n[\s\S]*?```markdown\n([\s\S]*?)\n```\n/,
  )?.[1];
  assert.equal(quote, AGENT_SNIPPET);
});

test("init creates AGENTS.md and skips absent CLAUDE.md", () => {
  withRoot((root) => {
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.deepEqual(outcome.files, {
      "AGENTS.md": "added",
      "CLAUDE.md": "skipped",
    });
    assert.equal(outcome.changed, true);
    assert.deepEqual(outcome.warnings, []);
    assert.equal(
      readFileSync(join(root, "AGENTS.md"), "utf8"),
      renderAgentsSection(),
    );
  });
});

test("init appends to existing files and preserves unrelated content", () => {
  withRoot((root) => {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "# Project\n\nBuild with npm.\n");

    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.equal(outcome.files["AGENTS.md"], "updated");
    const content = readFileSync(agentsPath, "utf8");
    assert.equal(content.startsWith("# Project\n\nBuild with npm.\n\n"), true);
    assert.ok(content.includes(renderAgentsSection()));
  });
});

test("init re-run is a no-op when the hash is fresh", () => {
  withRoot((root) => {
    updateAgentFiles({ repositoryRoot: root, operation: "init" });
    const before = readFileSync(join(root, "AGENTS.md"), "utf8");

    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.deepEqual(outcome.files, {
      "AGENTS.md": "unchanged",
      "CLAUDE.md": "skipped",
    });
    assert.equal(outcome.changed, false);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), before);
  });
});

test("init replaces a stale section by marker and preserves the rest", () => {
  withRoot((root) => {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(
      agentsPath,
      "# Project\n\n<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\nstale body\n<!-- END PLANLET AGENTS -->\n\nTail.\n",
    );

    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.equal(outcome.files["AGENTS.md"], "updated");
    const content = readFileSync(agentsPath, "utf8");
    assert.equal(content, `# Project\n\n${renderAgentsSection()}\nTail.\n`);
  });
});

test("stale CRLF sections are replaced with exactly one boundary newline", () => {
  withRoot((root) => {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(
      agentsPath,
      "# Project\r\n\r\n<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\r\nstale\r\n<!-- END PLANLET AGENTS -->\r\nTail.\r\n",
    );

    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "update",
    });
    assert.equal(outcome.files["AGENTS.md"], "updated");
    assert.equal(
      readFileSync(agentsPath, "utf8"),
      `# Project\r\n\r\n${renderAgentsSection()}Tail.\r\n`,
    );
  });
});

test("agent-file resolve failures become write_conflict with details", () => {
  withRoot((root) => {
    assert.throws(
      () =>
        updateAgentFiles({
          repositoryRoot: join(root, "missing"),
          operation: "init",
        }),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "write_conflict");
        assert.equal(error.details.file, "AGENTS.md");
        assert.equal(error.details.operation, "resolve");
        return true;
      },
    );
  });
});

test("agent-file write failures become write_conflict with details", () => {
  withRoot((root) => {
    writeFileSync(
      join(root, "AGENTS.md"),
      "<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\nstale\n<!-- END PLANLET AGENTS -->\n",
    );
    assert.throws(
      () =>
        updateAgentFiles({
          repositoryRoot: root,
          operation: "update",
          dependencies: {
            writeFile: () => {
              throw new Error("write boom");
            },
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "write_conflict");
        assert.equal(error.details.file, "AGENTS.md");
        assert.equal(error.details.operation, "write");
        return true;
      },
    );
  });
});

test("--no-agents skip writes nothing", () => {
  withRoot((root) => {
    writeFileSync(join(root, "CLAUDE.md"), "# Claude\n");
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
      skip: true,
    });
    assert.deepEqual(outcome.files, {
      "AGENTS.md": "skipped",
      "CLAUDE.md": "skipped",
    });
    assert.equal(outcome.changed, false);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# Claude\n");
  });
});

test("init CLAUDE.md rules: import skips, regular file writes, symlink skips", () => {
  withRoot((root) => {
    const imported = join(root, "CLAUDE.md");
    writeFileSync(imported, "See @AGENTS.md for instructions.\n");
    assert.equal(
      updateAgentFiles({ repositoryRoot: root, operation: "init" }).files[
        "CLAUDE.md"
      ],
      "skipped",
    );
    assert.equal(
      readFileSync(imported, "utf8"),
      "See @AGENTS.md for instructions.\n",
    );
  });

  withRoot((root) => {
    writeFileSync(join(root, "CLAUDE.md"), "# Claude\n");
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.equal(outcome.files["CLAUDE.md"], "updated");
    assert.ok(
      readFileSync(join(root, "CLAUDE.md"), "utf8").includes(
        renderAgentsSection(),
      ),
    );
  });

  withRoot((root) => {
    writeFileSync(join(root, "target.md"), "# Target\n");
    symlinkSync(join(root, "target.md"), join(root, "CLAUDE.md"));
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.equal(outcome.files["CLAUDE.md"], "skipped");
    assert.match(
      outcome.warnings.join("\n"),
      /CLAUDE\.md is not a regular file/,
    );
    assert.equal(readFileSync(join(root, "target.md"), "utf8"), "# Target\n");
  });
});

test("update refreshes present markers only and never creates files", () => {
  withRoot((root) => {
    const absent = updateAgentFiles({
      repositoryRoot: root,
      operation: "update",
    });
    assert.deepEqual(absent.files, {
      "AGENTS.md": "skipped",
      "CLAUDE.md": "skipped",
    });
    assert.equal(absent.changed, false);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
  });

  withRoot((root) => {
    writeFileSync(join(root, "AGENTS.md"), "# Foreign\n");
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "update",
    });
    assert.equal(outcome.files["AGENTS.md"], "skipped");
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "# Foreign\n");
  });

  withRoot((root) => {
    writeFileSync(
      join(root, "AGENTS.md"),
      "# Project\n\n<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\nstale\n<!-- END PLANLET AGENTS -->\n",
    );
    const updated = updateAgentFiles({
      repositoryRoot: root,
      operation: "update",
    });
    assert.equal(updated.files["AGENTS.md"], "updated");
    assert.equal(
      readFileSync(join(root, "AGENTS.md"), "utf8"),
      `# Project\n\n${renderAgentsSection()}`,
    );

    const fresh = updateAgentFiles({
      repositoryRoot: root,
      operation: "update",
    });
    assert.equal(fresh.files["AGENTS.md"], "unchanged");
    assert.equal(fresh.changed, false);
  });

  withRoot((root) => {
    const claudePath = join(root, "CLAUDE.md");
    writeFileSync(
      claudePath,
      "<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\nstale\n<!-- END PLANLET AGENTS -->\n",
    );
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "update",
    });
    assert.equal(outcome.files["CLAUDE.md"], "updated");
    assert.equal(readFileSync(claudePath, "utf8"), renderAgentsSection());
  });
});

test("foreign markers are preserved and our section appends", () => {
  withRoot((root) => {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(
      agentsPath,
      "<!-- BEGIN OTHER AGENTS v:1 hash:00000000 -->\nother\n<!-- END OTHER AGENTS -->\n",
    );
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.equal(outcome.files["AGENTS.md"], "updated");
    const content = readFileSync(agentsPath, "utf8");
    assert.ok(content.startsWith("<!-- BEGIN OTHER AGENTS"));
    assert.ok(content.includes("<!-- END OTHER AGENTS -->"));
    assert.ok(content.includes(renderAgentsSection()));
  });
});

test("malformed own markers leave the file alone with a warning", () => {
  withRoot((root) => {
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(
      agentsPath,
      "# Project\n\n<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\nno end marker\n",
    );
    const outcome = updateAgentFiles({
      repositoryRoot: root,
      operation: "init",
    });
    assert.equal(outcome.files["AGENTS.md"], "left-alone");
    assert.equal(outcome.changed, false);
    assert.match(outcome.warnings.join("\n"), /malformed planlet markers/);
    assert.equal(
      readFileSync(agentsPath, "utf8"),
      "# Project\n\n<!-- BEGIN PLANLET AGENTS v:1 hash:deadbeef -->\nno end marker\n",
    );
  });
});

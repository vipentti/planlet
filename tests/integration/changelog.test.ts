import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(root, "scripts", "changelog.mjs");
const fixture = join(root, "tests", "fixtures", "changelog.md");

function extract(version: string, changelogPath?: string) {
  const args = changelogPath
    ? [script, version, changelogPath]
    : [script, version];
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
  });
}

test("extracts one non-empty version and rejects invalid sections", () => {
  const known = extract("1.2.3", fixture);
  assert.equal(known.status, 0, known.stderr);
  assert.equal(
    known.stdout,
    "### Added\n\n- Known change\n\n### Fixed\n\n- Known fix\n",
  );

  for (const version of ["9.9.9", "2.0.0", "Unreleased"]) {
    const result = extract(version, fixture);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(version), result.stderr);
  }
});

test("defaults to the repository CHANGELOG.md when no file argument is given", () => {
  const known = extract("0.1.0");
  assert.equal(known.status, 0, known.stderr);
  assert.equal(
    known.stdout,
    [
      "### Added",
      "",
      "- Repository-local planlets with deterministic create, inspect, validate, task, and completion commands.",
      "- Portable planning, implementation, and completion skills for Agent Skills-compatible tools and Claude Code.",
      "- Project-local skill installation and update support for `agents`, `claude`, and `codex` destinations.",
      "- Bundled `planlet` executable for Node.js 22 and newer.",
      "",
      "### Changed",
      "",
      "- Interactive `planlet init` prompts for skill destinations while non-interactive use remains deterministic.",
      "- Documentation now leads with the skill-first workflow and complete CLI reference.",
      "",
      "### Security",
      "",
      "- Repository and planlet paths reject traversal and symlink escape.",
      "- Planlet creation, task updates, skill updates, and completion use recoverable or atomic filesystem operations.",
      "",
    ].join("\n"),
  );

  const missing = extract("9.9.9");
  assert.notEqual(missing.status, 0);
  assert.ok(missing.stderr.includes("9.9.9"), missing.stderr);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(root, "scripts", "changelog.mjs");

function extract(version: string, changelogPath?: string) {
  return spawnSync(
    process.execPath,
    [script, version, ...(changelogPath ? [changelogPath] : [])],
    { encoding: "utf8" },
  );
}

test("defaults to the repository CHANGELOG.md when no file argument is given", () => {
  const known = extract("0.1.0");
  assert.equal(known.status, 0, known.stderr);
  assert.ok(known.stdout.startsWith("### Added"), known.stdout);
  assert.ok(known.stdout.includes("Repository-local planlets"), known.stdout);

  for (const version of ["9.9.9", "Unreleased"]) {
    const result = extract(version);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(version), result.stderr);
  }
});

test("extracts one non-empty version and rejects empty sections from an isolated file", () => {
  const dir = mkdtempSync(join(tmpdir(), "planlet-changelog-"));
  const changelogPath = join(dir, "changelog.md");
  writeFileSync(
    changelogPath,
    [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "## [2.0.0] - 2026-07-31",
      "",
      "### Added",
      "",
      "## [1.2.3] - 2026-07-31",
      "",
      "### Added",
      "",
      "- Known change",
      "",
      "### Fixed",
      "",
      "- Known fix",
      "",
      "[Unreleased]: https://example.test/compare/1.2.3...HEAD",
      "[1.2.3]: https://example.test/releases/tag/1.2.3",
      "[2.0.0]: https://example.test/releases/tag/2.0.0",
      "",
    ].join("\n"),
  );

  const known = extract("1.2.3", changelogPath);
  assert.equal(known.status, 0, known.stderr);
  assert.ok(known.stdout.startsWith("### Added"), known.stdout);
  assert.ok(known.stdout.includes("Known change"), known.stdout);
  assert.ok(known.stdout.includes("Known fix"), known.stdout);

  const empty = extract("2.0.0", changelogPath);
  assert.notEqual(empty.status, 0);
  assert.ok(empty.stderr.includes("2.0.0"), empty.stderr);
});

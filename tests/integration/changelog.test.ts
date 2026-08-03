import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(root, "scripts", "changelog.mjs");
const releaseReady = join(
  root,
  "scripts",
  "assert-changelog-release-ready.mjs",
);

function extract(version: string, changelogPath?: string) {
  return spawnSync(
    process.execPath,
    [script, version, ...(changelogPath ? [changelogPath] : [])],
    { encoding: "utf8" },
  );
}

function assertReleaseReady(
  changelogPath: string,
  packagePath: string,
  env: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    process.execPath,
    [releaseReady, changelogPath, packagePath],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
}

test("repository changelog keeps 0.1.0 notes under Unreleased until dated", () => {
  const known = extract("0.1.0");
  assert.notEqual(known.status, 0);
  assert.ok(known.stderr.includes("0.1.0"), known.stderr);

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

test("release-ready gate accepts Unreleased 0.1.0 notes and matching dated headers", () => {
  const dir = mkdtempSync(join(tmpdir(), "planlet-changelog-ready-"));
  const packagePath = join(dir, "package.json");
  writeFileSync(packagePath, JSON.stringify({ version: "0.1.0" }));

  const unreleased = join(dir, "unreleased.md");
  writeFileSync(
    unreleased,
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Item\n",
  );
  assert.equal(assertReleaseReady(unreleased, packagePath).status, 0);

  const dated = join(dir, "dated.md");
  writeFileSync(
    dated,
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-08-10\n\n### Added\n\n- Item\n",
  );
  assert.notEqual(assertReleaseReady(dated, packagePath).status, 0);
  assert.equal(
    assertReleaseReady(dated, packagePath, {
      PLANLET_RELEASE_DATE: "2026-08-10",
    }).status,
    0,
  );
  assert.notEqual(
    assertReleaseReady(dated, packagePath, {
      PLANLET_RELEASE_DATE: "2026-08-11",
    }).status,
    0,
  );
});

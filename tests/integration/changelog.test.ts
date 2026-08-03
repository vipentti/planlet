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

function extract(version: string, changelogPath: string) {
  return spawnSync(process.execPath, [script, version, changelogPath], {
    encoding: "utf8",
  });
}

function assertReady(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [releaseReady, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function fixture(changelog: string, version = "0.1.0") {
  const dir = mkdtempSync(join(tmpdir(), "planlet-changelog-ready-"));
  const changelogPath = join(dir, "CHANGELOG.md");
  const packagePath = join(dir, "package.json");
  writeFileSync(changelogPath, changelog);
  writeFileSync(packagePath, JSON.stringify({ version }));
  return { changelogPath, packagePath };
}

// Release dates are relative to the day the suite runs: --release-date rejects
// past dates, so fixed dates would rot as the calendar advances.
function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const yesterday = utcDay(-1);
const today = utcDay(0);
const future = utcDay(1);
const later = utcDay(2);

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

test("ordinary CI allows Unreleased-only and structurally valid dated 0.1.0", () => {
  const unreleased = fixture(
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Item\n",
  );
  assert.equal(
    assertReady([unreleased.changelogPath, unreleased.packagePath]).status,
    0,
  );

  const dated = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n`,
  );
  assert.equal(assertReady([dated.changelogPath, dated.packagePath]).status, 0);

  const missingUnreleased = fixture(
    `# Changelog\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n`,
  );
  assert.notEqual(
    assertReady([
      missingUnreleased.changelogPath,
      missingUnreleased.packagePath,
    ]).status,
    0,
  );

  const duplicateUnreleased = fixture(
    "# Changelog\n\n## [Unreleased]\n\n## [Unreleased]\n\n### Added\n\n- Item\n",
  );
  assert.notEqual(
    assertReady([
      duplicateUnreleased.changelogPath,
      duplicateUnreleased.packagePath,
    ]).status,
    0,
  );

  const duplicateVersion = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n\n## [0.1.0] - ${later}\n\n### Added\n\n- Other\n`,
  );
  assert.notEqual(
    assertReady([duplicateVersion.changelogPath, duplicateVersion.packagePath])
      .status,
    0,
  );

  const invalidDay = fixture(
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-02-30\n\n### Added\n\n- Item\n",
  );
  assert.notEqual(
    assertReady([invalidDay.changelogPath, invalidDay.packagePath]).status,
    0,
  );

  const emptyNotes = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n`,
  );
  assert.notEqual(
    assertReady([emptyNotes.changelogPath, emptyNotes.packagePath]).status,
    0,
  );

  const undated = fixture(
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n\n### Added\n\n- Item\n",
  );
  assert.notEqual(
    assertReady([undated.changelogPath, undated.packagePath]).status,
    0,
  );
});

test("explicit release mode enforces dated non-empty matching 0.1.0 notes", () => {
  const unreleased = fixture(
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Item\n",
  );
  assert.notEqual(
    assertReady([
      "--release-date",
      future,
      unreleased.changelogPath,
      unreleased.packagePath,
    ]).status,
    0,
  );

  const undated = fixture(
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n\n### Added\n\n- Item\n",
  );
  assert.notEqual(
    assertReady([
      "--release-date",
      future,
      undated.changelogPath,
      undated.packagePath,
    ]).status,
    0,
  );

  const mismatch = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${later}\n\n### Added\n\n- Item\n`,
  );
  assert.notEqual(
    assertReady([
      "--release-date",
      future,
      mismatch.changelogPath,
      mismatch.packagePath,
    ]).status,
    0,
  );

  const invalidDay = fixture(
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-02-30\n\n### Added\n\n- Item\n",
  );
  assert.notEqual(
    assertReady([
      "--release-date",
      "2026-02-30",
      invalidDay.changelogPath,
      invalidDay.packagePath,
    ]).status,
    0,
  );

  const emptyNotes = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n`,
  );
  assert.notEqual(
    assertReady([
      "--release-date",
      future,
      emptyNotes.changelogPath,
      emptyNotes.packagePath,
    ]).status,
    0,
  );

  const good = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n`,
  );
  assert.equal(
    assertReady([
      "--release-date",
      future,
      good.changelogPath,
      good.packagePath,
    ]).status,
    0,
  );

  const otherVersion = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n`,
    "0.2.0",
  );
  assert.notEqual(
    assertReady([
      "--release-date",
      future,
      otherVersion.changelogPath,
      otherVersion.packagePath,
    ]).status,
    0,
  );
  assert.equal(
    assertReady([otherVersion.changelogPath, otherVersion.packagePath]).status,
    0,
  );
});

test("a past release date fails release verification but not ordinary CI", () => {
  const dated = (date: string) =>
    fixture(
      `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${date}\n\n### Added\n\n- Item\n`,
    );

  const current = dated(today);
  assert.equal(
    assertReady([current.changelogPath, current.packagePath]).status,
    0,
  );
  assert.equal(
    assertReady([
      "--release-date",
      today,
      current.changelogPath,
      current.packagePath,
    ]).status,
    0,
  );

  // Ordinary CI must stay green on an already-shipped version: package.json
  // sits on that version until the next release is prepared, so a past date is
  // the normal steady state, not a defect.
  const stale = dated(yesterday);
  assert.equal(assertReady([stale.changelogPath, stale.packagePath]).status, 0);
  assert.notEqual(
    assertReady([
      "--release-date",
      yesterday,
      stale.changelogPath,
      stale.packagePath,
    ]).status,
    0,
  );
});

test("malformed Unreleased and version headings still count and fail", () => {
  const cases = [
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - TBD\n\n### Added\n\n- Item\n",
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-8-10\n\n### Added\n\n- Item\n",
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future} extra\n\n### Added\n\n- Item\n`,
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n\n## [0.1.0] - TBD\n\n### Added\n\n- Dup\n`,
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - TBD\n\n### Added\n\n- A\n\n## [0.1.0] - TBD\n\n### Added\n\n- B\n",
    `# Changelog\n\n## [Unreleased]\n\n## [Unreleased] - ${future}\n\n### Added\n\n- Item\n`,
  ];
  for (const changelog of cases) {
    const files = fixture(changelog);
    assert.notEqual(
      assertReady([files.changelogPath, files.packagePath]).status,
      0,
      changelog,
    );
    assert.notEqual(
      assertReady([
        "--release-date",
        future,
        files.changelogPath,
        files.packagePath,
      ]).status,
      0,
      changelog,
    );
  }

  const good = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n`,
  );
  assert.equal(assertReady([good.changelogPath, good.packagePath]).status, 0);
  assert.equal(
    assertReady([
      "--release-date",
      future,
      good.changelogPath,
      good.packagePath,
    ]).status,
    0,
  );

  const dupFlag = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n`,
  );
  assert.notEqual(
    assertReady([
      "--release-date",
      future,
      "--release-date",
      later,
      dupFlag.changelogPath,
      dupFlag.packagePath,
    ]).status,
    0,
  );

  const extraPositional = fixture(
    `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - ${future}\n\n### Added\n\n- Item\n`,
  );
  assert.notEqual(
    assertReady([
      extraPositional.changelogPath,
      extraPositional.packagePath,
      "/tmp/extra",
    ]).status,
    0,
  );
});

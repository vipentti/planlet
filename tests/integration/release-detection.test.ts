import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceDetector = join(repoRoot, "scripts", "detect-release-merge.mjs");
const sourceHelper = join(
  repoRoot,
  "scripts",
  "assert-changelog-release-ready.mjs",
);

const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BASE_VERSION = "0.2.0";
const NEW_VERSION = "0.3.0";
const RELEASE_DATE = "2026-08-04";
const FIXED_NAME = "@vipentti/planlet";

function git(repo: string, ...args: string[]) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8" });
}

interface Repo {
  readonly dir: string;
  readonly baseSha: string;
}

function makeRepo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), "planlet-detect-"));
  tempDirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@test");
  git(dir, "config", "user.name", "test");

  mkdirSync(join(dir, "scripts"));
  writeFileSync(
    join(dir, "scripts", "detect-release-merge.mjs"),
    readFileSync(sourceDetector),
  );
  writeFileSync(
    join(dir, "scripts", "assert-changelog-release-ready.mjs"),
    readFileSync(sourceHelper),
  );

  writeJson(dir, "package.json", { name: FIXED_NAME, version: BASE_VERSION });
  writeJson(dir, "package-lock.json", {
    name: FIXED_NAME,
    version: BASE_VERSION,
    lockfileVersion: 3,
    packages: { "": { name: FIXED_NAME, version: BASE_VERSION } },
  });
  writeFileSync(join(dir, "CHANGELOG.md"), baseChangelog(), "utf8");

  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  const baseSha = git(dir, "rev-parse", "HEAD").stdout.trim();
  return { dir, baseSha };
}

function writeJson(dir: string, name: string, value: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", "utf8");
}

function baseChangelog(): string {
  return [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    `## [${BASE_VERSION}] - ${RELEASE_DATE}`,
    "",
    "### Added",
    "",
    "- Base release",
    "",
  ].join("\n");
}

function releaseChangelog(nonEmptyUnreleased = false): string {
  const unreleasedBody = nonEmptyUnreleased
    ? "\n- Stray unreleased entry\n"
    : "";
  return [
    "# Changelog",
    "",
    "## [Unreleased]",
    unreleasedBody,
    `## [${NEW_VERSION}] - ${RELEASE_DATE}`,
    "",
    "### Added",
    "",
    "- New release",
    "",
    `## [${BASE_VERSION}] - ${RELEASE_DATE}`,
    "",
    "### Added",
    "",
    "- Base release",
    "",
  ].join("\n");
}

function writeReleaseState(
  repo: string,
  options: {
    version?: string;
    lockVersion?: string;
    lockRootVersion?: string;
    name?: string | undefined;
    lockName?: string | undefined;
    lockRootName?: string | undefined;
    changelog?: string;
  } = {},
): void {
  const version = options.version ?? NEW_VERSION;
  const name = options.name ?? FIXED_NAME;
  const lockName = options.lockName ?? name;
  const lockRootName = options.lockRootName ?? lockName;
  writeJson(repo, "package.json", { name, version });
  writeJson(repo, "package-lock.json", {
    name: lockName,
    version: options.lockVersion ?? version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: lockRootName,
        version: options.lockRootVersion ?? options.lockVersion ?? version,
      },
    },
  });
  writeFileSync(
    join(repo, "CHANGELOG.md"),
    options.changelog ?? releaseChangelog(),
    "utf8",
  );
}

function commitAll(repo: string, message: string): string {
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD").stdout.trim();
}

function detect(
  repo: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [join(repo, "scripts", "detect-release-merge.mjs"), ...args],
    { cwd: repo, encoding: "utf8" },
  );
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function headSha(repo: string): string {
  return git(repo, "rev-parse", "HEAD").stdout.trim();
}

function assertRefused(result: { status: number; stderr: string }) {
  assert.notEqual(result.status, 0);
  assert.notEqual(result.stderr.trim(), "");
}

// ---------------------------------------------------------------------------
// Ordinary pushes
// ---------------------------------------------------------------------------

test("ordinary push with unchanged version is not a release", () => {
  const repo = makeRepo();
  writeFileSync(join(repo.dir, "notes.txt"), "ordinary\n");
  commitAll(repo.dir, "ordinary change");
  const out = detect(repo.dir, [
    "--before",
    repo.baseSha,
    "--after",
    headSha(repo.dir),
  ]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), { isRelease: false });
  assert.equal(out.stdout.trim().split("\n").length, 1);
});

// ---------------------------------------------------------------------------
// Valid release merge
// ---------------------------------------------------------------------------

test("release-file-only version bump is a release", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir);
  const after = commitAll(repo.dir, "release: 0.3.0");
  const out = detect(repo.dir, ["--before", repo.baseSha, "--after", after]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), {
    isRelease: true,
    version: "0.3.0",
  });
  assert.equal(out.stdout.trim().split("\n").length, 1);
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("package and lockfile version mismatch refuses", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir, { lockVersion: BASE_VERSION });
  const after = commitAll(repo.dir, "mismatch");
  assertRefused(detect(repo.dir, ["--before", repo.baseSha, "--after", after]));
});

test("lockfile root package version mismatch refuses", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir, { lockRootVersion: BASE_VERSION });
  const after = commitAll(repo.dir, "root mismatch");
  assertRefused(detect(repo.dir, ["--before", repo.baseSha, "--after", after]));
});

test("package identity mismatches refuse before release", () => {
  const cases: Array<{
    label: string;
    name?: string;
    lockName?: string;
    lockRootName?: string;
  }> = [
    { label: "package.json.name", name: "other" },
    { label: "package-lock.json.name", lockName: "other" },
    { label: "package-lock.json.packages[''].name", lockRootName: "other" },
    {
      label: "package.json.name containing LF",
      name: "@vipentti/planlet\nPWNED=1",
    },
    {
      label: "package.json.name containing CR",
      name: "@vipentti/planlet\rPWNED=1",
    },
  ];
  for (const c of cases) {
    const repo = makeRepo();
    writeReleaseState(repo.dir, {
      name: c.name,
      lockName: c.lockName,
      lockRootName: c.lockRootName,
    });
    const after = commitAll(repo.dir, "identity mismatch");
    const out = detect(repo.dir, ["--before", repo.baseSha, "--after", after]);
    assert.notEqual(out.status, 0, c.label);
    assert.match(out.stderr, /name is/i, c.label);
  }
});

test("malformed semver refuses", () => {
  for (const version of ["1.2", "1.2.3-beta", "1.2.3+build", "01.2.3"]) {
    const repo = makeRepo();
    writeReleaseState(repo.dir, { version });
    const after = commitAll(repo.dir, "bad semver");
    const out = detect(repo.dir, ["--before", repo.baseSha, "--after", after]);
    assert.notEqual(out.status, 0, version);
    assert.match(out.stderr, /not valid stable X\.Y\.Z semver/i);
  }
});

test("downgrade refuses", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir, { version: "0.1.0", lockVersion: "0.1.0" });
  const after = commitAll(repo.dir, "downgrade");
  assertRefused(detect(repo.dir, ["--before", repo.baseSha, "--after", after]));
});

test("unchanged version never enters release classification", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir, { version: BASE_VERSION });
  const after = commitAll(repo.dir, "same version");
  const out = detect(repo.dir, ["--before", repo.baseSha, "--after", after]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), { isRelease: false });
});

test("non-release file included in version-changing merge refuses", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir);
  writeFileSync(join(repo.dir, "notes.txt"), "unexpected\n");
  const after = commitAll(repo.dir, "release plus extra");
  assertRefused(detect(repo.dir, ["--before", repo.baseSha, "--after", after]));
});

test("missing, malformed, and unresolvable previous SHAs refuse", () => {
  const repo = makeRepo();
  const head = headSha(repo.dir);

  const missing = detect(repo.dir, ["--after", head]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing --before/);

  const nonHex = detect(repo.dir, ["--before", "nope", "--after", head]);
  assert.notEqual(nonHex.status, 0);
  assert.match(nonHex.stderr, /Ambiguous previous SHA/);

  const zero = detect(repo.dir, [
    "--before",
    "0000000000000000000000000000000000000000",
    "--after",
    head,
  ]);
  assert.notEqual(zero.status, 0);
  assert.match(zero.stderr, /Ambiguous previous SHA/);

  const unresolvable = detect(repo.dir, [
    "--before",
    "0123456789abcdef0123456789abcdef01234567",
    "--after",
    head,
  ]);
  assert.notEqual(unresolvable.status, 0);
  assert.match(unresolvable.stderr, /does not resolve to a commit/);
});

test("after SHA not equal to HEAD refuses", () => {
  const repo = makeRepo();
  const other = "0123456789abcdef0123456789abcdef01234567";
  const out = detect(repo.dir, ["--before", repo.baseSha, "--after", other]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /does not equal the checked-out HEAD/);
});

test("changelog without a section for the new version refuses", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir, { changelog: baseChangelog() });
  const after = commitAll(repo.dir, "missing changelog section");
  assertRefused(detect(repo.dir, ["--before", repo.baseSha, "--after", after]));
});

test("nonempty Unreleased changelog refuses", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir, { changelog: releaseChangelog(true) });
  const after = commitAll(repo.dir, "nonempty unreleased");
  assertRefused(detect(repo.dir, ["--before", repo.baseSha, "--after", after]));
});

test("existing expected tag at the triggering commit succeeds", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir);
  const after = commitAll(repo.dir, "release: 0.3.0");
  git(repo.dir, "tag", "-a", "v0.3.0", "-m", "tag", after);
  const out = detect(repo.dir, ["--before", repo.baseSha, "--after", after]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), {
    isRelease: true,
    version: "0.3.0",
  });
});

test("existing tag pointing to another commit refuses", () => {
  const repo = makeRepo();
  writeReleaseState(repo.dir);
  const after = commitAll(repo.dir, "release: 0.3.0");
  git(repo.dir, "tag", "-a", "v0.3.0", "-m", "tag", repo.baseSha);
  const out = detect(repo.dir, ["--before", repo.baseSha, "--after", after]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /points to/);
});

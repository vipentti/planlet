import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { verifyReleaseTag } from "../../scripts/verify-release-tag.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceReleaseScript = join(repoRoot, "scripts", "release.mjs");
const sourceHelper = join(
  repoRoot,
  "scripts",
  "assert-changelog-release-ready.mjs",
);
const sourceTagVerifier = join(repoRoot, "scripts", "verify-release-tag.mjs");

const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Repo {
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly script: string;
  readonly log: string;
  readonly ghLog: string;
}

interface GpgFixture {
  readonly home: string;
  readonly fingerprint: string;
}

function gpgHomePath(home: string): string {
  if (process.platform !== "win32" || home.startsWith("/")) return home;
  return `/${home.slice(0, 1).toLowerCase()}${home.slice(2).replaceAll("\\", "/")}`;
}

function gpgEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GNUPGHOME: gpgHomePath(home),
    MSYS2_ARG_CONV_EXCL: "*",
    MSYS_NO_PATHCONV: "1",
  };
}

function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const today = utcDay(0);
const pastDate = utcDay(-2);

function git(repo: Repo, ...args: string[]) {
  return spawnSync("git", args, {
    cwd: repo.dir,
    encoding: "utf8",
    env: repo.env,
  });
}

function ghStub(base: string, initialPrList: string): string {
  const bin = join(base, "bin");
  const prList = join(base, "pr-list.json");
  const ghLog = join(base, "gh.log");
  mkdirSync(bin);
  writeFileSync(prList, initialPrList);
  writeFileSync(ghLog, "");

  // POSIX shell stub, found directly by an un-shelled spawn.
  const stub = join(bin, "gh");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      `echo "$*" >> "${ghLog}"`,
      `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then cat "${prList}"; exit 0; fi`,
      `if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/vipentti/planlet/pull/100"; exit 0; fi`,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);

  // Windows batch stub: release.mjs resolves gh through a shell there, so
  // gh.cmd (found via PATHEXT) is the reachable program.
  writeFileSync(
    join(bin, "gh.cmd"),
    [
      "@echo off",
      `echo %*>> "${ghLog}"`,
      `if "%1"=="pr" if "%2"=="list" (type "${prList}" & exit /b 0)`,
      `if "%1"=="pr" if "%2"=="create" (echo https://github.com/vipentti/planlet/pull/100 & exit /b 0)`,
      "exit /b 1",
      "",
    ].join("\r\n"),
  );
  return ghLog;
}

interface MakeOptions {
  readonly released?: boolean;
  readonly version?: string;
  readonly prList?: string;
  readonly badSigningKey?: boolean;
  readonly skipPush?: boolean;
  readonly omitLinkReferences?: boolean;
}

function makeRepo(options: MakeOptions = {}): Repo {
  const version = options.version ?? "0.1.0";
  const base = mkdtempSync(join(tmpdir(), "planlet-release-"));
  tempDirs.push(base);
  const dir = join(base, "work");
  const origin = join(base, "origin.git");
  mkdirSync(dir);
  mkdirSync(join(dir, "scripts"));

  const gpgFixture = makeGpgFixture(join(base, "gnupg"));

  const runGit = (wd: string, ...args: string[]) =>
    spawnSync("git", args, {
      cwd: wd,
      encoding: "utf8",
      env: gpgEnv(gpgFixture.home),
    });

  runGit(base, "init", "--bare", "-q", origin);
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@test");
  runGit(dir, "config", "user.name", "test");

  runGit(dir, "config", "user.signingkey", gpgFixture.fingerprint);
  runGit(dir, "config", "gpg.format", "openpgp");
  runGit(dir, "config", "gpg.minTrustLevel", "ultimate");
  runGit(dir, "config", "commit.gpgsign", "true");
  runGit(dir, "config", "tag.gpgsign", "true");

  // Only the matching key is trusted; a different imported key fails commit verification.
  if (options.badSigningKey) {
    const other = makeGpgFixture(join(base, "other-gnupg"));
    const imported = spawnSync("gpg", ["--batch", "--import"], {
      input: exportGpgKey(other.home, other.fingerprint, true),
      encoding: "utf8",
      env: gpgEnv(gpgFixture.home),
    });
    assert.equal(imported.status, 0, imported.stderr);
    runGit(dir, "config", "user.signingkey", other.fingerprint);
  }

  // Repository content.
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: FIXED_NAME, version }, null, 2) + "\n",
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify(
      {
        name: FIXED_NAME,
        version,
        lockfileVersion: 3,
        packages: { "": { name: FIXED_NAME, version } },
      },
      null,
      2,
    ) + "\n",
  );
  const unreleased = options.released
    ? ""
    : "### Added\n\n- An unreleased item\n";
  const releasedSection = options.released
    ? `## [${version}] - ${pastDate}\n\n### Added\n\n- A released item\n`
    : "";
  const linkReferences = options.omitLinkReferences
    ? ""
    : "[Unreleased]: https://example.test/compare\n[" +
      version +
      "]: https://example.test/tag\n";
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    `# Changelog\n\n## [Unreleased]\n\n${unreleased}${releasedSection}${linkReferences}`,
  );

  copyFileSync(sourceReleaseScript, join(dir, "scripts", "release.mjs"));
  copyFileSync(
    sourceHelper,
    join(dir, "scripts", "assert-changelog-release-ready.mjs"),
  );
  copyFileSync(
    sourceTagVerifier,
    join(dir, "scripts", "verify-release-tag.mjs"),
  );
  chmodSync(join(dir, "scripts", "release.mjs"), 0o755);

  runGit(dir, "add", ".");
  runGit(dir, "commit", "-q", "-m", "init");
  runGit(dir, "branch", "-M", "main");
  runGit(dir, "remote", "add", "origin", origin);
  if (!options.skipPush) {
    runGit(dir, "push", "-q", "-u", "origin", "main");
  }

  const ghLog = ghStub(base, options.prList ?? "[]");
  const env: NodeJS.ProcessEnv = {
    ...gpgEnv(gpgFixture.home),
    PATH: join(base, "bin") + delimiter + process.env.PATH,
    RELEASE_GPG_FINGERPRINT: gpgFixture.fingerprint,
    PLANLET_TEST_REPO: dir,
  };
  return {
    dir,
    env,
    script: join(dir, "scripts", "release.mjs"),
    log: base,
    ghLog,
  };
}

function runGpg(home: string, ...args: string[]) {
  return spawnSync(
    "gpg",
    ["--batch", "--pinentry-mode", "loopback", "--passphrase", "", ...args],
    { encoding: "utf8", env: gpgEnv(home) },
  );
}

function makeGpgFixture(home: string): GpgFixture {
  mkdirSync(home, { mode: 0o700 });
  const generated = runGpg(
    home,
    "--quick-generate-key",
    "Planlet Release Test <release@example.test>",
    "rsa2048",
    "sign",
    "1d",
  );
  assert.equal(generated.status, 0, generated.stderr);
  const listed = runGpg(home, "--with-colons", "--list-secret-keys");
  assert.equal(listed.status, 0, listed.stderr);
  const fingerprint = listed.stdout
    .split("\n")
    .find((line) => line.startsWith("fpr:"))
    ?.split(":")[9];
  assert.match(fingerprint ?? "", /^[0-9A-Fa-f]{40}$/);
  return { home, fingerprint: fingerprint as string };
}

function exportGpgKey(
  home: string,
  fingerprint: string,
  secret: boolean,
): string {
  const result = runGpg(
    home,
    "--armor",
    secret ? "--export-secret-keys" : "--export",
    fingerprint,
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function withGpgHome<T>(home: string, callback: () => T): T {
  const previous = process.env.GNUPGHOME;
  process.env.GNUPGHOME = gpgHomePath(home);
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = previous;
  }
}

function release(repo: Repo, ...args: string[]) {
  return spawnSync(process.execPath, [repo.script, ...args], {
    cwd: repo.dir,
    encoding: "utf8",
    env: repo.env,
  });
}

function releaseFrom(repo: Repo, cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [repo.script, ...args], {
    cwd,
    encoding: "utf8",
    env: repo.env,
  });
}

function readJson(repo: Repo, name: string) {
  return JSON.parse(readFileSync(join(repo.dir, name), "utf8"));
}

function ghCalls(repo: Repo): string[] {
  return readFileSync(repo.ghLog, "utf8").split("\n").filter(Boolean);
}

const GOOD = "0.1.0";
const FIXED_NAME = "@vipentti/planlet";

// ---------------------------------------------------------------------------
// T1: CLI parsing
// ---------------------------------------------------------------------------

test("release CLI rejects a missing subcommand, unknown subcommand, and missing --version", () => {
  const repo = makeRepo();
  assert.notEqual(release(repo).status, 0);
  assert.notEqual(release(repo, "bogus", "--version", GOOD).status, 0);
  assert.notEqual(release(repo, "prepare").status, 0);
  const pushOnPrepare = release(repo, "prepare", "--version", GOOD, "--push");
  assert.notEqual(pushOnPrepare.status, 0);
  assert.match(pushOnPrepare.stderr, /--push is only valid for the tag/);
});

test("release CLI rejects duplicate value flags and unknown flags", () => {
  const repo = makeRepo();
  const dup = release(repo, "prepare", "--version", GOOD, "--version", "9.9.9");
  assert.notEqual(dup.status, 0);
  assert.match(dup.stdout + dup.stderr, /Duplicate --version/);
  assert.notEqual(
    release(repo, "prepare", "--version", GOOD, "--nope").status,
    0,
  );
});

// ---------------------------------------------------------------------------
// T3: prepare
// ---------------------------------------------------------------------------

test("prepare dry-run performs no mutations and prints a plan", () => {
  const repo = makeRepo();
  const out = release(repo, "prepare", "--version", "1.2.3");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Would cut changelog/);
  assert.match(out.stdout, /Would checkout main after PR create/);
  assert.match(out.stdout, /\[dry-run\]/);

  // No branch was created, no PR opened, and package.json is untouched.
  assert.notEqual(
    git(repo, "rev-parse", "--verify", "release/v1.2.3").status,
    0,
  );
  assert.deepEqual(
    ghCalls(repo).filter((c) => c.startsWith("pr create")),
    [],
  );
  assert.equal(readJson(repo, "package.json").version, "0.1.0");
});

test("prepare succeeds end to end: branch, three version fields, signed commit, push, PR", () => {
  const repo = makeRepo({ version: "0.1.0" });
  const mainShaBefore = git(repo, "rev-parse", "main").stdout.trim();
  const out = release(
    repo,
    "prepare",
    "--version",
    "1.2.3",
    "--release-date",
    today,
    "--execute",
  );
  assert.equal(out.status, 0, out.stderr + out.stdout);

  // Release branch exists locally and remotely.
  assert.equal(git(repo, "rev-parse", "--verify", "release/v1.2.3").status, 0);
  const remote = git(
    repo,
    "ls-remote",
    "--exit-code",
    "origin",
    "refs/heads/release/v1.2.3",
  );
  assert.equal(remote.status, 0);

  // Release commit holds the cut changelog and version bumps (worktree is back
  // on main, so inspect the branch tip rather than the working tree).
  const sha = git(repo, "rev-parse", "release/v1.2.3").stdout.trim();
  const changelog = git(repo, "show", `${sha}:CHANGELOG.md`).stdout;
  assert.ok(changelog.includes(`## [1.2.3] - ${today}`));
  const unreleasedBody =
    changelog
      .match(/## \[Unreleased\]\n([\s\S]*?)\n## \[1\.2\.3\]/)?.[1]
      ?.trim() ?? "missing";
  assert.equal(unreleasedBody, "");
  assert.ok(changelog.includes("An unreleased item\n"));
  assert.match(
    changelog,
    /^\[Unreleased\]: https:\/\/github\.com\/vipentti\/planlet\/compare\/v1\.2\.3\.\.\.HEAD$/m,
  );
  assert.match(
    changelog,
    /^\[1\.2\.3\]: https:\/\/github\.com\/vipentti\/planlet\/compare\/v0\.1\.0\.\.\.v1\.2\.3$/m,
  );
  assert.match(changelog, /^\[0\.1\.0\]: https:\/\/example\.test\/tag$/m);

  const pkg = JSON.parse(git(repo, "show", `${sha}:package.json`).stdout);
  assert.equal(pkg.version, "1.2.3");
  const lock = JSON.parse(git(repo, "show", `${sha}:package-lock.json`).stdout);
  assert.equal(lock.version, "1.2.3");
  assert.equal(lock.packages[""].version, "1.2.3");

  // Commit is signed and has one parent.
  const commitVerify = git(repo, "verify-commit", sha);
  assert.equal(
    commitVerify.status,
    0,
    commitVerify.stdout + commitVerify.stderr,
  );
  assert.equal(
    git(repo, "log", "--format=%s", "-1", sha).stdout.trim(),
    "release: 1.2.3",
  );
  assert.equal(
    git(repo, "rev-list", "--parents", "-n", "1", sha)
      .stdout.trim()
      .split(/\s+/).length,
    2,
  );

  // Commit touches only the release files.
  const changed = git(
    repo,
    "diff-tree",
    "--no-commit-id",
    "-r",
    "--name-only",
    sha,
  )
    .stdout.trim()
    .split("\n")
    .sort();
  assert.deepEqual(changed, [
    "CHANGELOG.md",
    "package-lock.json",
    "package.json",
  ]);

  // PR created only after a successful push.
  const creates = ghCalls(repo).filter((c) => c.startsWith("pr create"));
  assert.equal(creates.length, 1);

  // Checkout returns to main so the operator can fast-forward after merge.
  // Local main tip is unchanged; release work lives only on the release branch.
  assert.equal(git(repo, "branch", "--show-current").stdout.trim(), "main");
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), mainShaBefore);
  assert.equal(readJson(repo, "package.json").version, "0.1.0");
  assert.match(out.stdout, /Checked out main/);
});

test("prepare creates link references when changelog has none", () => {
  const repo = makeRepo({ omitLinkReferences: true });
  const out = release(
    repo,
    "prepare",
    "--version",
    "1.2.3",
    "--release-date",
    today,
    "--execute",
  );
  assert.equal(out.status, 0, out.stderr + out.stdout);

  const sha = git(repo, "rev-parse", "release/v1.2.3").stdout.trim();
  const changelog = git(repo, "show", `${sha}:CHANGELOG.md`).stdout;
  assert.match(
    changelog,
    /^\[Unreleased\]: https:\/\/github\.com\/vipentti\/planlet\/compare\/v1\.2\.3\.\.\.HEAD$/m,
  );
  assert.match(
    changelog,
    /^\[1\.2\.3\]: https:\/\/github\.com\/vipentti\/planlet\/compare\/v0\.1\.0\.\.\.v1\.2\.3$/m,
  );
});

test("prepare refuses when the worktree is dirty", () => {
  const repo = makeRepo();
  writeFileSync(join(repo.dir, "package.json"), '{ "version": "0.1.0" }\n');
  const out = release(repo, "prepare", "--version", "1.2.3", "--execute");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /not clean/i);
});

test("prepare refuses when HEAD does not match origin/main", () => {
  const repo = makeRepo({ skipPush: true });
  const out = release(repo, "prepare", "--version", "1.2.3", "--execute");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /origin\/main/);
});

test("prepare refuses existing local and remote release branches", () => {
  const local = makeRepo();
  git(local, "checkout", "-q", "-b", "release/v1.2.3");
  let out = release(local, "prepare", "--version", "1.2.3");
  assert.notEqual(out.status, 0);
  assert.match(
    out.stdout + out.stderr,
    /Branch release\/v1\.2\.3 already exists/i,
  );

  const remote = makeRepo();
  // Create the remote branch without a local ref so only the remote guard fires.
  git(remote, "push", "-q", "origin", "HEAD:refs/heads/release/v3.2.1");
  out = release(remote, "prepare", "--version", "3.2.1");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /Remote branch/);
});

test("prepare refuses matching open, merged, and closed-unmerged PRs", () => {
  const pr = (state: string) =>
    `[{"number":1,"state":"${state}","url":"https://example.test/pr/1"}]`;
  let repo = makeRepo({ prList: pr("OPEN") });
  let out = release(repo, "prepare", "--version", "1.2.3");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /Open PR/);

  repo = makeRepo({ prList: pr("MERGED") });
  out = release(repo, "prepare", "--version", "1.2.3");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /Merged PR/);

  repo = makeRepo({ prList: pr("CLOSED") });
  out = release(repo, "prepare", "--version", "1.2.3");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /Closed\/unmerged/);
});

test("prepare refuses an already current version, existing changelog section, and remote tag", () => {
  const current = makeRepo({ version: "1.2.3" });
  let out = release(current, "prepare", "--version", "1.2.3");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /already 1\.2\.3/);

  const changelogRepo = makeRepo();
  writeFileSync(
    join(changelogRepo.dir, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- X\n\n## [1.2.3] - 2026-01-01\n\n### Added\n\n- Y\n",
  );
  git(changelogRepo, "add", "CHANGELOG.md");
  git(changelogRepo, "commit", "-q", "-m", "ship 1.2.3");
  git(changelogRepo, "push", "-q", "origin", "main");
  out = release(changelogRepo, "prepare", "--version", "1.2.3");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /already contains section/);

  const tagRepo = makeRepo();
  git(tagRepo, "push", "-q", "origin", "HEAD:refs/tags/v2.0.0");
  out = release(tagRepo, "prepare", "--version", "2.0.0");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /remote tag/i);
});

test("prepare refuses before push when a post-commit hook mutates an allowed release file", () => {
  const repo = makeRepo();
  const diag = installHook(repo, [
    'import { readFileSync, writeFileSync } from "node:fs";',
    "const d = process.env.PLANLET_TEST_REPO;",
    'const p = JSON.parse(readFileSync(d + "/package.json", "utf8"));',
    'p.version = "9.9.9";',
    'writeFileSync(d + "/package.json", JSON.stringify(p, null, 2) + "\\n");',
    "",
  ]);
  const out = release(
    repo,
    "prepare",
    "--version",
    "1.2.3",
    "--release-date",
    today,
    "--execute",
  );
  assertHookRefused(repo, out, diag);
  // The signed commit was left in place for inspection.
  assert.equal(git(repo, "rev-parse", "--verify", "release/v1.2.3").status, 0);
});

interface HookDiag {
  readonly marker: string;
  readonly errlog: string;
}

function installHook(repo: Repo, mutatorBody: string[]): HookDiag {
  const mutatorPath = join(repo.log, "mutate.mjs");
  writeFileSync(mutatorPath, mutatorBody.join("\n"));
  const marker = join(repo.log, "hook-ran");
  const errlog = join(repo.log, "hook-err.log");
  const hooks = join(repo.dir, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "post-commit");
  const node = process.execPath.replace(/\\/g, "/");
  writeFileSync(
    hook,
    [
      "#!/bin/sh",
      `echo ran > "${marker.replace(/\\/g, "/")}"`,
      `"${node}" "${mutatorPath.replace(/\\/g, "/")}" 2>> "${errlog.replace(
        /\\/g,
        "/",
      )}"`,
      "",
    ].join("\n"),
  );
  chmodSync(hook, 0o755);
  return { marker, errlog };
}

function assertHookRefused(
  repo: Repo,
  out: ReturnType<typeof release>,
  diag: HookDiag,
): void {
  const marker = existsSync(diag.marker)
    ? readFileSync(diag.marker, "utf8").trim()
    : "(missing)";
  const err = existsSync(diag.errlog)
    ? readFileSync(diag.errlog, "utf8")
    : "(none)";
  const detail = `hook-ran=${marker} hook-err=${err} stdout=${out.stdout} stderr=${out.stderr}`;
  assert.notEqual(out.status, 0, detail);
  assert.equal(
    git(repo, "ls-remote", "--exit-code", "origin", "refs/heads/release/v1.2.3")
      .status,
    2,
    detail,
  );
  assert.deepEqual(
    ghCalls(repo).filter((c) => c.startsWith("pr create")),
    [],
    detail,
  );
}

const HOOK_VARIANTS: ReadonlyArray<[string, string[]]> = [
  [
    "mutates package-lock.json.version",
    [
      'import { readFileSync, writeFileSync } from "node:fs";',
      "const d = process.env.PLANLET_TEST_REPO;",
      'const p = JSON.parse(readFileSync(d + "/package-lock.json", "utf8"));',
      'p.version = "9.9.9";',
      'writeFileSync(d + "/package-lock.json", JSON.stringify(p, null, 2) + "\\n");',
      "",
    ],
  ],
  [
    "creates an untracked file",
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.PLANLET_TEST_REPO + "/unexpected.txt", "boom\\n");',
      "",
    ],
  ],
  [
    "stages an unexpected new file",
    [
      'import { writeFileSync } from "node:fs";',
      'import { spawnSync } from "node:child_process";',
      "const d = process.env.PLANLET_TEST_REPO;",
      'writeFileSync(d + "/staged.txt", "boom\\n");',
      'spawnSync("git", ["add", "staged.txt"], { cwd: d, stdio: "ignore" });',
      "",
    ],
  ],
];

for (const [label, mutator] of HOOK_VARIANTS) {
  test(`prepare refuses when a post-commit hook ${label}`, () => {
    const repo = makeRepo();
    const diag = installHook(repo, mutator);
    const out = release(
      repo,
      "prepare",
      "--version",
      "1.2.3",
      "--release-date",
      today,
      "--execute",
    );
    assertHookRefused(repo, out, diag);
  });
}

test("prepare refuses before push and leaves the local commit when the signature does not verify", () => {
  const repo = makeRepo({ badSigningKey: true });
  const out = release(
    repo,
    "prepare",
    "--version",
    "1.2.3",
    "--release-date",
    today,
    "--execute",
  );
  assert.notEqual(out.status, 0);
  // The signed commit was created and left in place for inspection.
  assert.equal(git(repo, "rev-parse", "--verify", "release/v1.2.3").status, 0);
  assert.equal(
    git(repo, "ls-remote", "--exit-code", "origin", "refs/heads/release/v1.2.3")
      .status,
    2,
  );
  assert.deepEqual(
    ghCalls(repo).filter((c) => c.startsWith("pr create")),
    [],
  );
});

// ---------------------------------------------------------------------------
// T4: tag
// ---------------------------------------------------------------------------

function stubHelper(repo: Repo, body: string) {
  writeFileSync(
    join(repo.dir, "scripts", "assert-changelog-release-ready.mjs"),
    body,
  );
}

function makeHelperStub(stdout = "", exitCode = 0): string {
  return `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(
    stdout,
  )});\nprocess.exit(${exitCode});\n`;
}

test("tag refuses malformed or extra helper output on stdout", () => {
  // Extra trailing line: not exactly one YYYY-MM-DD line.
  const extra = makeRepo({ released: true });
  stubHelper(extra, makeHelperStub(pastDate + "\nEXTRA\n", 0));
  let out = release(extra, "tag", "--version", GOOD, "--execute");
  assert.notEqual(out.status, 0);
  assert.equal(git(extra, "tag", "-l", "v" + GOOD).stdout.trim(), "");

  // Malformed date with correct-line shape.
  const malformed = makeRepo({ released: true });
  stubHelper(malformed, makeHelperStub("not-a-date\n", 0));
  out = release(malformed, "tag", "--version", GOOD, "--execute");
  assert.notEqual(out.status, 0);
  assert.equal(git(malformed, "tag", "-l", "v" + GOOD).stdout.trim(), "");
});

test("tag refuses when the historical helper exits nonzero", () => {
  const repo = makeRepo({ released: true });
  stubHelper(repo, makeHelperStub("", 1));
  const out = release(repo, "tag", "--version", GOOD, "--execute");
  assert.notEqual(out.status, 0);
  assert.equal(git(repo, "tag", "-l", "v" + GOOD).stdout.trim(), "");
});

test("tag dry-run reports the resolved recorded date and mutates nothing", () => {
  const repo = makeRepo({ released: true });
  const out = release(repo, "tag", "--version", GOOD);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, new RegExp(pastDate));
  assert.equal(git(repo, "tag", "-l", "v" + GOOD).stdout.trim(), "");
  assert.deepEqual(
    ghCalls(repo).filter((c) => c.startsWith("pr create")),
    [],
  );
});

test("tag accepts a historical past date and succeeds for a matching expected date", () => {
  // The recorded date is two days ago; historical mode has no past-date rule.
  const past = makeRepo({ released: true });
  let out = release(past, "tag", "--version", GOOD, "--execute");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(git(past, "verify-tag", "v" + GOOD).status, 0);
  // No push without --push.
  assert.ok(
    !git(past, "ls-remote", "--exit-code", "origin", "refs/tags/v" + GOOD)
      .stdout,
  );

  // Matching expected date.
  const match = makeRepo({ released: true });
  out = release(
    match,
    "tag",
    "--version",
    GOOD,
    "--release-date",
    pastDate,
    "--execute",
  );
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(git(match, "verify-tag", "v" + GOOD).status, 0);
});

test("tag refuses a mismatching expected release date before creating the tag", () => {
  const repo = makeRepo({ released: true });
  const out = release(
    repo,
    "tag",
    "--version",
    GOOD,
    "--release-date",
    today,
    "--execute",
  );
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /does not match|mismatch|date/i);
  assert.equal(git(repo, "tag", "-l", "v" + GOOD).stdout.trim(), "");
});

test("tag refuses when the remote tag already exists", () => {
  const repo = makeRepo({ released: true });
  // Create a lightweight remote tag without a local ref or signing.
  git(repo, "push", "-q", "origin", "HEAD:refs/tags/v" + GOOD);
  const out = release(repo, "tag", "--version", GOOD, "--execute");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /already exists/);
});

test("tag --execute --push creates, verifies, pushes, and verifies the remote tag", () => {
  const repo = makeRepo({ released: true });
  const out = release(repo, "tag", "--version", GOOD, "--execute", "--push");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(git(repo, "verify-tag", "v" + GOOD).status, 0);
  const subject = git(
    repo,
    "tag",
    "-l",
    "--format=%(contents:subject)",
    "v" + GOOD,
  );
  assert.equal(subject.stdout.trim(), "Release v" + GOOD);
  const remote = git(
    repo,
    "ls-remote",
    "--exit-code",
    "origin",
    "refs/tags/v" + GOOD,
  );
  assert.equal(remote.status, 0);
  const localObj = git(repo, "rev-parse", "v" + GOOD).stdout.trim();
  const remoteObj = remote.stdout.trim().split(/\s+/)[0];
  assert.equal(remoteObj, localObj);
});

test("tag two-step workflow validates an existing local tag and pushes later", () => {
  const repo = makeRepo({ released: true });
  git(repo, "tag", "-a", "-s", "v" + GOOD, "-m", "Release v" + GOOD, "HEAD");

  // Step 1: report ready, do not push.
  const step1 = release(repo, "tag", "--version", GOOD, "--execute");
  assert.equal(step1.status, 0, step1.stderr);
  assert.equal(
    git(repo, "ls-remote", "--exit-code", "origin", "refs/tags/v" + GOOD)
      .status,
    2,
  );

  // Step 2: push.
  const step2 = release(repo, "tag", "--version", GOOD, "--execute", "--push");
  assert.equal(step2.status, 0, step2.stderr);

  // Messages that are not the canonical "Release v<version>" subject are refused.
  const bad = makeRepo({ released: true });
  git(bad, "tag", "-a", "-s", "v" + GOOD, "-m", "wrong message", "HEAD");
  const badOut = release(bad, "tag", "--version", GOOD, "--execute", "--push");
  assert.notEqual(badOut.status, 0);
});

test("tag rejects an existing local tag with a bare v<version> subject", () => {
  const repo = makeRepo({ released: true });
  git(repo, "tag", "-a", "-s", "v" + GOOD, "-m", "v" + GOOD, "HEAD");
  const out = release(repo, "tag", "--version", GOOD, "--execute");
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /message is/);
  assert.equal(
    git(repo, "ls-remote", "--exit-code", "origin", "refs/tags/v" + GOOD)
      .status,
    2,
  );
});

test("tag refuses a mismatched package identity", () => {
  const repo = makeRepo({ released: true });
  const pkg = readJson(repo, "package.json");
  pkg.name = "other";
  writeFileSync(
    join(repo.dir, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
  );
  git(repo, "add", "package.json");
  git(repo, "commit", "-q", "-m", "rename");
  git(repo, "push", "-q", "origin", "main");

  const out = release(repo, "tag", "--version", GOOD, "--execute");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /package\.json\.name is/);
});

test("break-glass tag satisfies the same verifier arguments as the workflow", () => {
  const repo = makeRepo({ released: true });
  const out = release(repo, "tag", "--version", GOOD, "--execute");
  assert.equal(out.status, 0, out.stderr);
  const head = git(repo, "rev-parse", "HEAD").stdout.trim();
  const verify = withGpgHome(repo.env.GNUPGHOME as string, () =>
    verifyReleaseTag({
      tag: "v" + GOOD,
      target: head,
      message: "Release v" + GOOD,
      expectedFingerprint: repo.env.RELEASE_GPG_FINGERPRINT as string,
      cwd: repo.dir,
    }),
  );
  assert.equal(verify.ok, true, verify.ok ? "" : verify.error);
});

test("fresh break-glass tag verifies when release.mjs runs from an unrelated directory", () => {
  const repo = makeRepo({ released: true });
  const outside = join(repo.log, "outside");
  mkdirSync(outside);

  const out = releaseFrom(repo, outside, "tag", "--version", GOOD, "--execute");
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.equal(git(repo, "verify-tag", "v" + GOOD).status, 0);
  const subject = git(
    repo,
    "tag",
    "-l",
    "--format=%(contents:subject)",
    "v" + GOOD,
  );
  assert.equal(subject.stdout.trim(), "Release v" + GOOD);
});

test("existing local tag validates when release.mjs runs from an unrelated directory", () => {
  const repo = makeRepo({ released: true });
  git(repo, "tag", "-a", "-s", "v" + GOOD, "-m", "Release v" + GOOD, "HEAD");
  const outside = join(repo.log, "outside");
  mkdirSync(outside);

  const out = releaseFrom(repo, outside, "tag", "--version", GOOD, "--execute");
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.match(out.stdout, /exists locally and is valid/);
  assert.equal(
    git(repo, "ls-remote", "--exit-code", "origin", "refs/tags/v" + GOOD)
      .status,
    2,
  );
});

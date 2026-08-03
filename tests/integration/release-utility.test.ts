import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceReleaseScript = join(repoRoot, "scripts", "release.mjs");
const sourceHelper = join(
  repoRoot,
  "scripts",
  "assert-changelog-release-ready.mjs",
);

interface Repo {
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly script: string;
  readonly log: string;
  readonly ghLog: string;
}

function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const today = utcDay(0);
const pastDate = utcDay(-2);

function git(repo: Repo, ...args: string[]) {
  return spawnSync("git", args, { cwd: repo.dir, encoding: "utf8" });
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
}

function makeRepo(options: MakeOptions = {}): Repo {
  const version = options.version ?? "0.1.0";
  const base = mkdtempSync(join(tmpdir(), "planlet-release-"));
  const dir = join(base, "work");
  const origin = join(base, "origin.git");
  mkdirSync(dir);
  mkdirSync(join(dir, "scripts"));

  const runGit = (wd: string, ...args: string[]) =>
    spawnSync("git", args, { cwd: wd, encoding: "utf8" });

  runGit(base, "init", "--bare", "-q", origin);
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@test");
  runGit(dir, "config", "user.name", "test");

  // SSH signing key + allowed signers.
  const key = join(base, "key");
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], {
    encoding: "utf8",
  });
  const pub = spawnSync("ssh-keygen", ["-y", "-f", key], {
    encoding: "utf8",
  }).stdout.trim();
  const allowed = join(base, "allowed");
  writeFileSync(allowed, `test namespaces="git" ${pub}\n`);
  runGit(dir, "config", "user.signingkey", key);
  runGit(dir, "config", "gpg.format", "ssh");
  runGit(dir, "config", "gpg.ssh.allowedSignersFile", allowed);
  runGit(dir, "config", "commit.gpgsign", "true");
  runGit(dir, "config", "tag.gpgsign", "true");

  // Only the matching key is allowed; a different one fails verification.
  if (options.badSigningKey) {
    const other = join(base, "other");
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", other], {
      encoding: "utf8",
    });
    runGit(dir, "config", "user.signingkey", other);
  }

  // Repository content.
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "x", version }, null, 2) + "\n",
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify(
      { name: "x", version, lockfileVersion: 3, packages: { "": { version } } },
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
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    `# Changelog\n\n## [Unreleased]\n\n${unreleased}${releasedSection}[Unreleased]: https://example.test/compare\n[${version}]: https://example.test/tag\n`,
  );

  copyFileSync(sourceReleaseScript, join(dir, "scripts", "release.mjs"));
  copyFileSync(
    sourceHelper,
    join(dir, "scripts", "assert-changelog-release-ready.mjs"),
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
    ...process.env,
    PATH: join(base, "bin") + ":" + process.env.PATH,
  };
  return {
    dir,
    env,
    script: join(dir, "scripts", "release.mjs"),
    log: base,
    ghLog,
  };
}

function release(repo: Repo, ...args: string[]) {
  return spawnSync(process.execPath, [repo.script, ...args], {
    cwd: repo.dir,
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

  // Changelog cut: Unreleased empty, new dated version section holds the notes.
  const changelog = readFileSync(join(repo.dir, "CHANGELOG.md"), "utf8");
  assert.ok(changelog.includes(`## [1.2.3] - ${today}`));
  const unreleasedBody =
    changelog
      .match(/## \[Unreleased\]\n([\s\S]*?)\n## \[1\.2\.3\]/)?.[1]
      ?.trim() ?? "missing";
  assert.equal(unreleasedBody, "");
  assert.ok(changelog.includes("An unreleased item\n"));

  // Three root version fields written.
  assert.equal(readJson(repo, "package.json").version, "1.2.3");
  const lock = readJson(repo, "package-lock.json");
  assert.equal(lock.version, "1.2.3");
  assert.equal(lock.packages[""].version, "1.2.3");

  // Commit is signed and has one parent.
  const sha = git(repo, "rev-parse", "HEAD").stdout.trim();
  assert.equal(git(repo, "verify-commit", sha).status, 0);
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
  // The mutator lives outside the worktree so it does not dirty it.
  const mutator = join(repo.log, "mutate.mjs");
  writeFileSync(
    mutator,
    [
      'import { readFileSync, writeFileSync } from "node:fs";',
      'const p = JSON.parse(readFileSync("package.json", "utf8"));',
      'p.version = "9.9.9";',
      'writeFileSync("package.json", JSON.stringify(p, null, 2) + "\\n");',
      "",
    ].join("\n"),
  );
  const hooks = join(repo.dir, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "post-commit");
  writeFileSync(hook, ["#!/bin/sh", `node ${mutator}`].join("\n") + "\n");
  chmodSync(hook, 0o755);

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
  // No push, no PR.
  assert.equal(
    git(repo, "ls-remote", "--exit-code", "origin", "refs/heads/release/v1.2.3")
      .status,
    2,
  );
  assert.deepEqual(
    ghCalls(repo).filter((c) => c.startsWith("pr create")),
    [],
  );
  // The signed commit was left in place for inspection.
  assert.equal(git(repo, "rev-parse", "--verify", "release/v1.2.3").status, 0);
});

function withPostCommitHook(repo: Repo, mutator: string[]): void {
  const mutatorPath = join(repo.log, "mutate.mjs");
  writeFileSync(mutatorPath, mutator.join("\n"));
  const hooks = join(repo.dir, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "post-commit");
  writeFileSync(hook, ["#!/bin/sh", `node ${mutatorPath}`].join("\n") + "\n");
  chmodSync(hook, 0o755);
}

const HOOK_VARIANTS: ReadonlyArray<[string, string[]]> = [
  [
    "mutates package-lock.json.version",
    [
      'import { readFileSync, writeFileSync } from "node:fs";',
      'const p = JSON.parse(readFileSync("package-lock.json", "utf8"));',
      'p.version = "9.9.9";',
      'writeFileSync("package-lock.json", JSON.stringify(p, null, 2) + "\\n");',
      "",
    ],
  ],
  [
    "creates an untracked file",
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync("unexpected.txt", "boom\\n");',
      "",
    ],
  ],
  [
    "stages an unexpected new file",
    [
      'import { writeFileSync } from "node:fs";',
      'import { spawnSync } from "node:child_process";',
      'writeFileSync("staged.txt", "boom\\n");',
      'spawnSync("git", ["add", "staged.txt"], { stdio: "ignore" });',
      "",
    ],
  ],
];

for (const [label, mutator] of HOOK_VARIANTS) {
  test(`prepare refuses when a post-commit hook ${label}`, () => {
    const repo = makeRepo();
    withPostCommitHook(repo, mutator);
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
    assert.equal(
      git(
        repo,
        "ls-remote",
        "--exit-code",
        "origin",
        "refs/heads/release/v1.2.3",
      ).status,
      2,
    );
    assert.deepEqual(
      ghCalls(repo).filter((c) => c.startsWith("pr create")),
      [],
    );
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
  assert.equal(out.status, 0, out.stderr);
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
  assert.equal(out.status, 0, out.stderr);
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
  assert.equal(out.status, 0, out.stderr);
  assert.equal(git(repo, "verify-tag", "v" + GOOD).status, 0);
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
  git(repo, "tag", "-a", "-s", "v" + GOOD, "-m", "v" + GOOD, "HEAD");

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

  // Messages that are not exactly v<version> are refused.
  const bad = makeRepo({ released: true });
  git(bad, "tag", "-a", "-s", "v" + GOOD, "-m", "wrong message", "HEAD");
  const badOut = release(bad, "tag", "--version", GOOD, "--execute", "--push");
  assert.notEqual(badOut.status, 0);
});

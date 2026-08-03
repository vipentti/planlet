#!/usr/bin/env node

/**
 * Release-cut maintainer utility.
 *
 * Subcommands:
 *   prepare --version X.Y.Z [--release-date D] [--execute]
 *   tag     --version X.Y.Z [--release-date D] [--execute] [--push]
 *
 * Dry-run is default. --execute enables mutations. --push is tag-only.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const changelogPath = resolve(root, "CHANGELOG.md");
const packageJsonPath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function git(...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r;
}

function gh(...args) {
  const r = spawnSync("gh", args, { cwd: root, encoding: "utf8" });
  return r;
}

function hasGitClean() {
  const r = git("status", "--porcelain");
  return r.status === 0 && r.stdout.trim() === "";
}

function getRemoteMainSha() {
  const r = git("ls-remote", "origin", "refs/heads/main");
  if (r.status !== 0)
    fail("git ls-remote origin/main failed: " + r.stderr.trim());
  const sha = r.stdout.trim().split(/\s+/)[0];
  if (!sha) fail("Could not resolve origin/main from remote.");
  return sha;
}

function currentHeadSha() {
  const r = git("rev-parse", "HEAD");
  if (r.status !== 0) fail("git rev-parse HEAD failed.");
  return r.stdout.trim();
}

function remoteRefExists(ref) {
  const r = git("ls-remote", "--exit-code", "origin", ref);
  // exit 0 = found, 2 = not found, other = error
  if (r.status === 0) return true;
  if (r.status === 2) return false;
  fail("git ls-remote failed for " + ref + ": " + r.stderr.trim());
}

function parseVersionSuffix(suffix) {
  if (!suffix || suffix.trim() === "") return { kind: "bare" };
  const m = /^ - (\d{4}-\d{2}-\d{2})$/.exec(suffix);
  return m ? { kind: "dated", date: m[1] } : { kind: "malformed", raw: suffix };
}

function getChangelogReleaseDate(version) {
  const changelog = readFileSync(changelogPath, "utf8");
  const re = new RegExp(
    `^## \\[${escapeRegex(version)}\\] - (\\d{4}-\\d{2}-\\d{2})$`,
    "m",
  );
  const m = re.exec(changelog);
  return m ? m[1] : null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isValidCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) return false;
  return instant.toISOString().slice(0, 10) === value;
}

function validateReleaseContents(version, date) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (pkg.version !== version)
    fail("package.json.version is " + pkg.version + ", expected " + version);
  const lock = JSON.parse(readFileSync(packageLockPath, "utf8"));
  if (lock.version !== version)
    fail(
      "package-lock.json.version is " + lock.version + ", expected " + version,
    );
  const pkgEntry = lock.packages?.[""];
  if (!pkgEntry || typeof pkgEntry !== "object")
    fail('package-lock.json.packages[""] is missing or not an object');
  if (pkgEntry.version !== version)
    fail(
      'package-lock.json.packages[""].version is ' +
        pkgEntry.version +
        ", expected " +
        version,
    );
  // changelog validation via the helper's strict preparation mode
  const r = spawnSync(
    process.execPath,
    ["scripts/assert-changelog-release-ready.mjs", "--release-date", date],
    { cwd: root, encoding: "utf8" },
  );
  if (r.status !== 0)
    fail("Changelog validation failed:\n" + (r.stderr || r.stdout).trim());
}

// --- Subcommand definitions ---

const SUBCOMMANDS = ["prepare", "tag"];

function usage() {
  console.log(`Usage: release.mjs <prepare|tag> [options]

Options:
  --version V       Required. Version to release (e.g. 1.2.3)
  --release-date D  Release date (YYYY-MM-DD). For prepare: date to write.
                    For tag: date the changelog is expected to record.
  --execute         Enable mutations. Default: dry-run.
  --push            (tag only) Push the tag after creation.
  -h, --help        Show this help.

Examples:
  release.mjs prepare --version 1.2.3
  release.mjs prepare --version 1.2.3 --execute
  release.mjs tag --version 1.2.3 --execute --push
`);
  process.exit(0);
}

// --- Parse ---

const args = process.argv.slice(2);
const subcommand = args[0];
if (subcommand === "--help" || subcommand === "-h") usage();
if (args.length === 0)
  fail(
    "Missing subcommand (expected prepare or tag).\n" +
      "  release.mjs <prepare|tag> --version X.Y.Z [--execute]",
  );
if (!SUBCOMMANDS.includes(subcommand))
  fail(
    "Unknown subcommand: " +
      subcommand +
      " (expected prepare or tag).\n" +
      "  release.mjs <prepare|tag> --version X.Y.Z [--execute]",
  );

let values;
try {
  ({ values } = parseArgs({
    args: args.slice(1),
    options: {
      version: { type: "string" },
      "release-date": { type: "string" },
      execute: { type: "boolean" },
      push: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  }));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

// Reject duplicate value flags (parseArgs is last-wins by default).
for (const name of ["version", "release-date"]) {
  if (
    args
      .slice(1)
      .filter((a) => a === "--" + name || a.startsWith("--" + name + "="))
      .length > 1
  ) {
    fail("Duplicate --" + name + " option.");
  }
}

if (values.help) usage();
if (!values.version) fail("--version is required.");
const version = values.version;
const releaseDate = values["release-date"];
const isExecute = values.execute ?? false;
const isPush = values.push ?? false;

if (isPush && subcommand !== "tag")
  fail("--push is only valid for the tag subcommand.");

if (!/^\d+\.\d+\.\d+$/.test(version))
  fail("--version must be a valid semver (e.g. 1.2.3).");

if (releaseDate !== undefined && !isValidCalendarDate(releaseDate))
  fail("--release-date must be a valid calendar date YYYY-MM-DD.");

// --- Helpers: print plan ---

function plan(msg) {
  const prefix = isExecute ? "[exec]" : "[dry-run]";
  console.log(prefix + " " + msg);
}

// ===================================================================
// prepare
// ===================================================================

async function cmdPrepare() {
  const branchName = "release/v" + version;

  plan("Subcommand: prepare");
  plan("Version: " + version);
  plan("Branch: " + branchName);
  plan("Release date: " + (releaseDate ?? todayUtc()));

  // --- Guards ---

  // 1. Clean worktree
  if (!hasGitClean())
    fail("Worktree is not clean. Commit or stash changes first.");

  // 2. HEAD == remote main tip
  const remoteMainSha = getRemoteMainSha();
  const headSha = currentHeadSha();
  if (headSha !== remoteMainSha)
    fail(
      "HEAD (" +
        headSha.slice(0, 8) +
        ") does not match origin/main (" +
        remoteMainSha.slice(0, 8) +
        "). Pull or rebase first.",
    );

  // 3. Local release branch
  const localBranch = git("rev-parse", "--verify", branchName);
  if (localBranch.status === 0)
    fail(
      "Local branch " +
        branchName +
        " already exists. Delete or rename it, then rerun.",
    );

  // 4. Remote release branch
  const remoteBranchRef = "refs/heads/" + branchName;
  if (remoteRefExists(remoteBranchRef))
    fail(
      "Remote branch " +
        branchName +
        " already exists. Resolve it manually, then rerun.",
    );

  // 5. Matching PRs
  const prList = gh(
    "pr",
    "list",
    "--head",
    branchName,
    "--base",
    "main",
    "--state",
    "all",
    "--json",
    "number,state,url",
  );
  if (prList.status !== 0) fail("Failed to list PRs: " + prList.stderr.trim());
  const prs = JSON.parse(prList.stdout || "[]");
  if (prs.length > 0) {
    if (prs.some((p) => p.state === "OPEN"))
      fail(
        "Open PR for " +
          branchName +
          " found: " +
          prs.map((p) => p.url).join(", "),
      );
    if (prs.some((p) => p.state === "MERGED"))
      fail("Merged PR for " + branchName + " found. Version already prepared.");
    fail(
      "Closed/unmerged PR for " +
        branchName +
        " found. Manual action required.",
    );
  }

  // 6. Version not already current
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (pkg.version === version)
    fail(
      "package.json.version is already " +
        version +
        ". Choose a different version.",
    );

  // 7. Changelog doesn't already contain version
  const changelog = readFileSync(changelogPath, "utf8");
  if (changelog.includes("## [" + version + "]"))
    fail("Changelog already contains section for " + version + ".");

  // 8. Remote tag doesn't exist
  if (remoteRefExists("refs/tags/v" + version))
    fail(
      "Remote tag v" + version + " already exists. Version already released.",
    );

  const date = releaseDate ?? todayUtc();

  // --- Dry-run: print plan and exit ---
  if (!isExecute) {
    plan("Would cut changelog for " + version + " (" + date + ")");
    plan("Would set package.json.version = " + version);
    plan("Would set package-lock.json.version = " + version);
    plan('Would set package-lock.json.packages[""].version = ' + version);
    plan(
      'Would commit -S -m "release: ' + version + '" on branch ' + branchName,
    );
    plan("Would push " + branchName + " to origin");
    plan("Would create PR (base: main)");
    return;
  }

  // --- Execute ---

  // Cut changelog: move the Unreleased body into a new dated version section,
  // leaving Unreleased empty, preserving everything below (other sections and
  // section-link references).
  const changelogContent = readFileSync(changelogPath, "utf8");
  const unreleasedIdx = changelogContent.indexOf("## [Unreleased]");
  if (unreleasedIdx === -1)
    fail("Could not find [Unreleased] section in changelog.");
  const rest = changelogContent.slice(unreleasedIdx);
  const boundary = rest.search(/\n## \[|\n\[[^\]]+\]:/);
  const unreleasedSection = boundary === -1 ? rest : rest.slice(0, boundary);
  const bodyMatch = unreleasedSection.match(/^## \[Unreleased\]\n\n([\s\S]*)$/);
  const unreleasedBody = bodyMatch ? bodyMatch[1].trim() : "";
  if (!unreleasedBody)
    fail("[Unreleased] section is empty; nothing to release.");
  const after = boundary === -1 ? "" : rest.slice(boundary).replace(/^\n+/, "");
  const before = changelogContent.slice(0, unreleasedIdx);
  const newChangelog =
    before +
    "## [Unreleased]\n\n" +
    "## [" +
    version +
    "] - " +
    date +
    "\n\n" +
    unreleasedBody +
    "\n\n" +
    after;

  writeFileSync(changelogPath, newChangelog, "utf8");

  // Update package.json
  const pkgData = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  pkgData.version = version;
  writeFileSync(
    packageJsonPath,
    JSON.stringify(pkgData, null, 2) + "\n",
    "utf8",
  );

  // Update package-lock.json
  const lockData = JSON.parse(readFileSync(packageLockPath, "utf8"));
  lockData.version = version;
  if (lockData.packages?.[""]) lockData.packages[""].version = version;
  writeFileSync(
    packageLockPath,
    JSON.stringify(lockData, null, 2) + "\n",
    "utf8",
  );

  // Validate contents
  validateReleaseContents(version, date);

  // Commit
  const commitMsg = "release: " + version;
  const checkout = git("checkout", "-b", branchName);
  if (checkout.status !== 0)
    fail("Failed to create branch: " + checkout.stderr.trim());

  const add = git("add", changelogPath, packageJsonPath, packageLockPath);
  if (add.status !== 0) fail("git add failed: " + add.stderr.trim());

  const commit = git("commit", "-S", "-m", commitMsg);
  if (commit.status !== 0) fail("git commit failed: " + commit.stderr.trim());

  // Post-commit checks
  const newSha = currentHeadSha();
  // Verify commit message
  const logMsg = git("log", "--format=%s", "-1", newSha);
  if (logMsg.status !== 0 || logMsg.stdout.trim() !== commitMsg)
    fail(
      "Commit message mismatch: expected '" +
        commitMsg +
        "', got '" +
        logMsg.stdout.trim() +
        "'.",
    );

  // Verify one parent
  const parentCount = git("rev-list", "--parents", "-n", "1", newSha);
  if (parentCount.status !== 0) fail("Failed to get parent count.");
  const parentParts = parentCount.stdout.trim().split(/\s+/);
  if (parentParts.length !== 2)
    fail("Expected exactly one parent, got " + (parentParts.length - 1) + ".");

  // Verify signature
  const verify = git("verify-commit", newSha);
  if (verify.status !== 0)
    fail("git verify-commit failed:\n" + verify.stderr.trim());

  // Verify changed paths are only the release files
  const diffTree = git(
    "diff-tree",
    "--no-commit-id",
    "-r",
    "--name-only",
    newSha,
  );
  if (diffTree.status !== 0) fail("Failed to get changed files.");
  const changedFiles = diffTree.stdout.trim().split("\n").filter(Boolean);
  const allowed = ["CHANGELOG.md", "package.json", "package-lock.json"];
  const unexpected = changedFiles.filter((f) => !allowed.includes(f));
  if (unexpected.length > 0)
    fail("Unexpected changed files in commit: " + unexpected.join(", "));

  // Repository-state checks
  if (!hasGitClean())
    fail("Worktree is not clean after commit. A hook may have modified files.");

  // Validate committed contents
  validateReleaseContents(version, date);

  // Push
  const push = git("push", "origin", newSha + ":refs/heads/" + branchName);
  if (push.status !== 0) fail("git push failed:\n" + push.stderr.trim());

  // Verify remote ref
  const remoteSha = git("ls-remote", "origin", "refs/heads/" + branchName);
  if (remoteSha.status !== 0) fail("Failed to verify remote branch.");
  const pushedSha = remoteSha.stdout.trim().split(/\s+/)[0];
  if (pushedSha !== newSha)
    fail(
      "Remote branch ref mismatch: expected " + newSha + ", got " + pushedSha,
    );

  // Create PR
  const pr = gh(
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branchName,
    "--title",
    commitMsg,
    "--body",
    "Release **" +
      version +
      "** (" +
      date +
      ").\n\nSee CHANGELOG.md for details.",
  );
  if (pr.status !== 0) fail("gh pr create failed:\n" + pr.stderr.trim());
  console.log("PR created: " + pr.stdout.trim());
}

// ===================================================================
// tag
// ===================================================================

async function cmdTag() {
  // Read the release date from the changelog via the helper's historical mode.
  // Accept stdout only as exactly one YYYY-MM-DD line with a single trailing
  // newline and nothing else; refuse on malformed output or nonzero exit.
  const resolvedDate = (() => {
    const args = [
      "scripts/assert-changelog-release-ready.mjs",
      "--verify-release",
    ];
    if (releaseDate) {
      args.push("--date", releaseDate);
    }
    args.push("--print-date");
    const r = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
    });
    if (r.status !== 0)
      fail(
        "Changelog historical verification failed:\n" +
          (r.stderr || r.stdout).trim(),
      );
    const shape = /^\d{4}-\d{2}-\d{2}\n$/.exec(r.stdout);
    if (!shape)
      fail(
        "Changelog helper printed an unexpected value (expected exactly one YYYY-MM-DD line):\n" +
          JSON.stringify(r.stdout),
      );
    if (!isValidCalendarDate(shape[0].trim()))
      fail("Changelog helper returned a malformed date: " + shape[0].trim());
    return shape[0].trim();
  })();

  plan("Subcommand: tag");
  plan("Version: " + version);
  plan("Release date: " + resolvedDate);
  if (isPush) plan("Will push tag");

  // --- Guards ---

  // 1. Clean worktree
  if (!hasGitClean())
    fail("Worktree is not clean. Commit or stash changes first.");

  // 2. HEAD == remote main tip
  const remoteMainSha = getRemoteMainSha();
  const headSha = currentHeadSha();
  if (headSha !== remoteMainSha)
    fail(
      "HEAD (" +
        headSha.slice(0, 8) +
        ") does not match origin/main (" +
        remoteMainSha.slice(0, 8) +
        "). Pull or rebase first.",
    );

  // 3. package.json version matches
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (pkg.version !== version)
    fail(
      "package.json.version is " + pkg.version + ", expected " + version + ".",
    );

  // 4. Remote tag exists?
  const tagRef = "refs/tags/v" + version;
  if (remoteRefExists(tagRef))
    fail(
      "Remote tag v" + version + " already exists. Version already released.",
    );

  // 5. Local tag exists? validate it
  const localTag = git("tag", "-l", "v" + version);
  const tagExistsLocally =
    localTag.status === 0 && localTag.stdout.trim() === "v" + version;

  if (tagExistsLocally) {
    // Validate existing local tag
    const tagType = git("cat-file", "-t", "v" + version);
    if (tagType.status !== 0 || tagType.stdout.trim() !== "tag")
      fail("Local tag v" + version + " is not an annotated tag.");

    const tagMsg = git(
      "tag",
      "-l",
      "--format=%(contents:subject)",
      "v" + version,
    );
    if (tagMsg.status !== 0 || tagMsg.stdout.trim() !== "v" + version)
      fail("Local tag v" + version + " message mismatch.");

    const tagTarget = git("rev-parse", "v" + version + "^{commit}");
    if (tagTarget.status !== 0 || tagTarget.stdout.trim() !== headSha)
      fail("Local tag v" + version + " does not point at current HEAD.");

    const tagVerify = git("verify-tag", "v" + version);
    if (tagVerify.status !== 0)
      fail(
        "git verify-tag failed for v" +
          version +
          ":\n" +
          tagVerify.stderr.trim(),
      );

    if (!isExecute) {
      plan(
        "Tag v" +
          version +
          " exists locally and is valid. Would push with --push.",
      );
      return;
    }

    if (!isPush) {
      console.log(
        "Tag v" +
          version +
          " exists locally and is valid. Ready to push (run with --push).",
      );
      return;
    }
  } else {
    // Fresh tag creation
    if (!isExecute) {
      plan("Would create signed annotated tag v" + version + " on HEAD");
      if (isPush) plan("Would push tag v" + version + " to origin");
      return;
    }

    // Fresh tag
    const tag = git(
      "tag",
      "-a",
      "-s",
      "v" + version,
      "-m",
      "v" + version,
      "HEAD",
    );
    if (tag.status !== 0)
      fail("git tag creation failed:\n" + tag.stderr.trim());

    const verify = git("verify-tag", "v" + version);
    if (verify.status !== 0)
      fail("git verify-tag failed:\n" + verify.stderr.trim());
  }

  // Push if --push
  if (isPush) {
    const push = git(
      "push",
      "origin",
      "refs/tags/v" + version + ":refs/tags/v" + version,
    );
    if (push.status !== 0) fail("git push tag failed:\n" + push.stderr.trim());

    // Verify remote tag
    const tagObj = git("rev-parse", "v" + version);
    if (tagObj.status !== 0) fail("Failed to get local tag object SHA.");

    const remoteTag = git("ls-remote", "origin", tagRef);
    if (remoteTag.status !== 0) fail("Failed to verify remote tag.");
    const remoteTagSha = remoteTag.stdout.trim().split(/\s+/)[0];
    if (remoteTagSha !== tagObj.stdout.trim())
      fail(
        "Remote tag ref mismatch: expected " +
          tagObj.stdout.trim() +
          ", got " +
          remoteTagSha,
      );

    console.log("Tag v" + version + " pushed successfully.");
  }
}

// --- Dispatch ---

if (subcommand === "prepare") {
  cmdPrepare().catch((err) =>
    fail(err instanceof Error ? err.message : String(err)),
  );
} else if (subcommand === "tag") {
  cmdTag().catch((err) =>
    fail(err instanceof Error ? err.message : String(err)),
  );
}

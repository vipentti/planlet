#!/usr/bin/env node

/**
 * Detect whether a push to main is a prepared release merge.
 *
 * Usage:
 *   node scripts/detect-release-merge.mjs --before <sha> [--after <sha>]
 *
 * Runs in a checkout of the triggering commit (--after defaults to HEAD and
 * must equal HEAD when passed). Prints exactly one JSON line on success:
 *   {"isRelease":false}
 *   {"isRelease":true,"version":"X.Y.Z"}
 * Any refusal writes a diagnostic to stderr and exits nonzero. Missing,
 * malformed, or unresolvable previous SHAs fail closed and are never treated
 * as ordinary or as a release.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { isValidCalendarDate } from "./assert-changelog-release-ready.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const releaseFiles = ["CHANGELOG.md", "package.json", "package-lock.json"];
const zeroSha = "0000000000000000000000000000000000000000";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(...args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

function resolveCommit(rev) {
  const r = git("rev-parse", "--verify", "--quiet", rev + "^{commit}");
  if (r.status !== 0) return null;
  const sha = r.stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function stableSemver(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  // Semver forbids leading zeros.
  if (match.slice(1).some((segment, i) => segment !== String(parts[i]))) {
    return null;
  }
  return parts;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function readJsonFromGit(path, ref) {
  const r = git("show", `${ref}:${path}`);
  if (r.status !== 0)
    fail(`Could not read ${path} at ${ref}: ${(r.stderr || "").trim()}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    fail(`Malformed JSON in ${path} at ${ref}.`);
  }
}

function readJsonFromWorktree(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    fail(
      `Could not read ${path} from the worktree: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function validChangelog() {
  const r = spawnSync(
    process.execPath,
    [
      join(root, "scripts", "assert-changelog-release-ready.mjs"),
      "--verify-release",
      "--print-date",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (r.status !== 0) {
    fail(
      "Changelog does not describe a valid released version:\n" +
        (r.stderr || r.stdout).trim(),
    );
  }
  // Historical mode prints exactly YYYY-MM-DD\n on success; anything else is
  // malformed helper output and must not count as a valid changelog.
  const shape = /^(\d{4}-\d{2}-\d{2})\n$/.exec(r.stdout);
  if (!shape || !isValidCalendarDate(shape[1])) {
    fail("Changelog helper returned a malformed release date.");
  }
}

// --- Parse arguments ---

let values;
try {
  ({ values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      before: { type: "string" },
      after: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (values.help) {
  console.log(
    "Usage: node scripts/detect-release-merge.mjs --before <sha> [--after <sha>]",
  );
  process.exit(0);
}

if (typeof values.before !== "string" || values.before === "") {
  fail("Missing --before: cannot classify a push without a previous SHA.");
}

const before = values.before;
if (!/^[0-9a-f]{40}$/.test(before)) {
  fail(`Ambiguous previous SHA: ${before} is not a 40-character hex SHA.`);
}
if (before === zeroSha) {
  fail("Ambiguous previous SHA: all-zero before SHA is not a valid baseline.");
}
if (!resolveCommit(before)) {
  fail(`Ambiguous previous SHA: ${before} does not resolve to a commit.`);
}

const headSha = resolveCommit("HEAD");
if (!headSha) fail("Could not resolve HEAD to a commit.");

const after = values.after ?? headSha;
if (!/^[0-9a-f]{40}$/.test(after)) {
  fail(`Ambiguous target SHA: ${after} is not a 40-character hex SHA.`);
}
if (after !== headSha) {
  fail(`Target SHA ${after} does not equal the checked-out HEAD ${headSha}.`);
}

// --- Read release state ---

const afterPkg = readJsonFromWorktree("package.json");
const afterLock = readJsonFromWorktree("package-lock.json");
const beforePkg = readJsonFromGit("package.json", before);

const afterVersion = afterPkg.version;
const beforeVersion = beforePkg.version;

// Unchanged version: ordinary push. No release work, no environment approval.
if (beforeVersion === afterVersion) {
  console.log(JSON.stringify({ isRelease: false }));
  process.exit(0);
}

// --- Release rules ---

const newVersion = stableSemver(afterVersion);
if (!newVersion) {
  fail(
    `package.json.version ${JSON.stringify(afterVersion)} is not valid stable X.Y.Z semver.`,
  );
}

const previous = stableSemver(beforeVersion);
if (!previous) {
  fail(
    `Previous package.json.version ${JSON.stringify(
      beforeVersion,
    )} is not valid stable X.Y.Z semver; cannot prove an increase.`,
  );
}
if (compareVersions(newVersion, previous) <= 0) {
  fail(
    `New version ${afterVersion} is not greater than previous ${beforeVersion}.`,
  );
}

if (afterLock.version !== afterVersion) {
  fail(
    `package-lock.json.version is ${JSON.stringify(
      afterLock.version,
    )}, expected ${afterVersion}.`,
  );
}
const rootEntry = afterLock.packages?.[""];
if (typeof rootEntry !== "object" || rootEntry === null) {
  fail('package-lock.json.packages[""] is missing or not an object.');
}
if (rootEntry.version !== afterVersion) {
  fail(
    `package-lock.json.packages[""].version is ${JSON.stringify(
      rootEntry.version,
    )}, expected ${afterVersion}.`,
  );
}

const changed = git("diff", "--name-only", before, after)
  .stdout.trim()
  .split("\n")
  .filter(Boolean)
  .sort();
const expected = [...releaseFiles].sort();
if (
  changed.length !== expected.length ||
  changed.some((f, i) => f !== expected[i])
) {
  fail(
    `Release merge must change exactly ${releaseFiles.join(", ")}; found: ${
      changed.length === 0 ? "(none)" : changed.join(", ")
    }.`,
  );
}

validChangelog();

const tag = "refs/tags/v" + afterVersion;
const tagSha = git("rev-parse", "--verify", "--quiet", tag);
if (tagSha.status === 0) {
  const tagTarget = resolveCommit(tag);
  if (tagTarget !== after) {
    fail(
      `Tag v${afterVersion} points to ${tagTarget}, not the triggering commit ${after}.`,
    );
  }
}

console.log(JSON.stringify({ isRelease: true, version: afterVersion }));

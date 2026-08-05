#!/usr/bin/env node

/**
 * Verify an annotated signed release tag in the current repository.
 *
 * Usage:
 *   node scripts/verify-release-tag.mjs --tag v1.2.3 --target <sha> --message "v1.2.3"
 *
 * Requires the tag to be an annotated object, to point at the exact target
 * commit, to have the exact expected message subject, and to carry a
 * signature Git verifies (git verify-tag). Prints the tag object SHA on
 * success; writes a diagnostic to stderr and exits nonzero otherwise.
 */

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(...args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

let values;
try {
  ({ values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      tag: { type: "string" },
      target: { type: "string" },
      message: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (values.help) {
  console.log(
    "Usage: node scripts/verify-release-tag.mjs --tag vX.Y.Z --target <sha> --message <expected>",
  );
  process.exit(0);
}

if (typeof values.tag !== "string" || values.tag === "") {
  fail("Missing --tag.");
}
if (
  typeof values.target !== "string" ||
  !/^[0-9a-f]{40}$/.test(values.target)
) {
  fail("Missing or malformed --target (expected a 40-character hex SHA).");
}
if (typeof values.message !== "string" || values.message === "") {
  fail("Missing --message.");
}

const tag = values.tag;
const ref = "refs/tags/" + tag;

const objectType = git("cat-file", "-t", ref);
if (objectType.status !== 0 || objectType.stdout.trim() !== "tag") {
  fail(
    `Release tag ${tag} is not an annotated tag (found ${
      objectType.stdout.trim() || "(missing)"
    }).`,
  );
}

const targetCommit = git("rev-parse", "--verify", "--quiet", ref + "^{commit}");
if (targetCommit.status !== 0 || targetCommit.stdout.trim() !== values.target) {
  fail(
    `Tag ${tag} points to ${
      targetCommit.stdout.trim() || "(unresolvable)"
    }, expected ${values.target}.`,
  );
}

const subject = git("tag", "-l", "--format=%(contents:subject)", tag);
if (subject.status !== 0 || subject.stdout.trim() !== values.message) {
  fail(
    `Tag ${tag} message is ${JSON.stringify(
      subject.stdout.trim(),
    )}, expected ${JSON.stringify(values.message)}.`,
  );
}

const verify = git("verify-tag", tag);
if (verify.status !== 0) {
  fail(`git verify-tag failed for ${tag}:\n${verify.stderr.trim()}`);
}

const objectSha = git("rev-parse", ref);
if (objectSha.status !== 0 || !/^[0-9a-f]{40}$/.test(objectSha.stdout.trim())) {
  fail(`Could not resolve tag object SHA for ${tag}.`);
}

console.log(objectSha.stdout.trim());

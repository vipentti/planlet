#!/usr/bin/env node

/**
 * Verify an annotated signed release tag in the current repository.
 *
 * CLI:
 *   node scripts/verify-release-tag.mjs --tag v1.2.3 --target <sha> --message "Release v1.2.3"
 *
 * Requires an annotated object at the exact target commit with the exact
 * message subject and a Git-verified signature. Prints the tag object SHA on
 * success; diagnostics to stderr, nonzero exit otherwise.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

function git(...args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

export function verifyReleaseTag({ tag, target, message }) {
  const ref = "refs/tags/" + tag;
  const type = git("cat-file", "-t", ref);
  if (type.status !== 0 || type.stdout.trim() !== "tag")
    return {
      ok: false,
      error: `Release tag ${tag} is not an annotated tag (found ${
        type.stdout.trim() || "(missing)"
      }).`,
    };
  const targetCommit = git(
    "rev-parse",
    "--verify",
    "--quiet",
    ref + "^{commit}",
  );
  if (targetCommit.status !== 0 || targetCommit.stdout.trim() !== target)
    return {
      ok: false,
      error: `Tag ${tag} points to ${
        targetCommit.stdout.trim() || "(unresolvable)"
      }, expected ${target}.`,
    };
  const subject = git("tag", "-l", "--format=%(contents:subject)", tag);
  if (subject.status !== 0 || subject.stdout.trim() !== message)
    return {
      ok: false,
      error: `Tag ${tag} message is ${JSON.stringify(
        subject.stdout.trim(),
      )}, expected ${JSON.stringify(message)}.`,
    };
  const verify = git("verify-tag", tag);
  if (verify.status !== 0)
    return {
      ok: false,
      error: `git verify-tag failed for ${tag}:\n${verify.stderr.trim()}`,
    };
  const objectSha = git("rev-parse", ref);
  if (objectSha.status !== 0 || !/^[0-9a-f]{40}$/.test(objectSha.stdout.trim()))
    return { ok: false, error: `Could not resolve tag object SHA for ${tag}.` };
  return { ok: true, objectSha: objectSha.stdout.trim() };
}

// CLI entry only; importing this module must not run argument parsing.
if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const usage =
    "Usage: node scripts/verify-release-tag.mjs --tag vX.Y.Z --target <sha> --message <expected>";
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }
  const { tag, target, message } = values;
  if (!tag || !/^[0-9a-f]{40}$/.test(target ?? "") || !message) {
    console.error(usage);
    process.exit(1);
  }
  const result = verifyReleaseTag({ tag, target, message });
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(result.objectSha);
}

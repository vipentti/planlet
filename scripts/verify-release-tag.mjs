/**
 * Verify an annotated signed release tag in the given repository working
 * directory. Module interface only; scripts/release.mjs imports it for the
 * break-glass tag flow.
 */

import { spawnSync } from "node:child_process";

function git(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

export function verifyReleaseTag({
  tag,
  target,
  message,
  cwd = process.cwd(),
}) {
  const ref = "refs/tags/" + tag;
  const type = git(cwd, "cat-file", "-t", ref);
  if (type.status !== 0 || type.stdout.trim() !== "tag")
    return {
      ok: false,
      error: `Release tag ${tag} is not an annotated tag (found ${
        type.stdout.trim() || "(missing)"
      }).`,
    };
  const targetCommit = git(
    cwd,
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
  const subject = git(cwd, "tag", "-l", "--format=%(contents:subject)", tag);
  if (subject.status !== 0 || subject.stdout.trim() !== message)
    return {
      ok: false,
      error: `Tag ${tag} message is ${JSON.stringify(
        subject.stdout.trim(),
      )}, expected ${JSON.stringify(message)}.`,
    };
  const verify = git(cwd, "verify-tag", tag);
  if (verify.status !== 0)
    return {
      ok: false,
      error: `git verify-tag failed for ${tag}:\n${verify.stderr.trim()}`,
    };
  const objectSha = git(cwd, "rev-parse", ref);
  if (objectSha.status !== 0 || !/^[0-9a-f]{40}$/.test(objectSha.stdout.trim()))
    return { ok: false, error: `Could not resolve tag object SHA for ${tag}.` };
  return { ok: true, objectSha: objectSha.stdout.trim() };
}

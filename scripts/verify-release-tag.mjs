/**
 * Verify an annotated signed release tag in the given repository working
 * directory. Module interface only; scripts/release.mjs imports it for the
 * break-glass tag flow. Callers must provide the trusted primary fingerprint;
 * verification never falls back to any locally imported key.
 */

import { spawnSync } from "node:child_process";

const FINGERPRINT = /^[0-9a-f]{40}$/i;

function git(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function validSignatureFingerprint(output, expectedFingerprint) {
  const records = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[0] === "[GNUPG:]" && fields[1] === "VALIDSIG");
  if (records.length !== 1)
    return {
      ok: false,
      error: `Expected exactly one VALIDSIG status, found ${records.length}.`,
    };

  const fields = records[0];
  const signingFingerprint = fields[2];
  const primaryFingerprint =
    fields.length > 11 ? fields.at(-1) : signingFingerprint;
  if (
    !FINGERPRINT.test(signingFingerprint ?? "") ||
    !FINGERPRINT.test(primaryFingerprint ?? "")
  )
    return {
      ok: false,
      error: "VALIDSIG status contains a malformed fingerprint.",
    };

  const actual = primaryFingerprint.toUpperCase();
  const expected = expectedFingerprint.toUpperCase();
  if (actual !== expected)
    return {
      ok: false,
      error: `Tag signature primary fingerprint ${actual} does not match expected ${expected}.`,
    };
  return { ok: true };
}

/**
 * @typedef {{
 *   tag: string,
 *   target: string,
 *   message: string,
 *   expectedFingerprint: string,
 *   cwd?: string,
 * }} VerifyReleaseTagOptions
 */

/** @param {VerifyReleaseTagOptions} options */
export function verifyReleaseTag(options) {
  const {
    tag,
    target,
    message,
    expectedFingerprint,
    cwd = process.cwd(),
  } = options;
  if (
    typeof expectedFingerprint !== "string" ||
    !FINGERPRINT.test(expectedFingerprint)
  )
    return {
      ok: false,
      error:
        "expectedFingerprint must be exactly one 40-character hexadecimal fingerprint.",
    };

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
  const verify = git(cwd, "verify-tag", "--raw", tag);
  if (verify.status !== 0)
    return {
      ok: false,
      error: `git verify-tag failed for ${tag}:\n${verify.stderr.trim()}`,
    };
  const signer = validSignatureFingerprint(
    verify.stdout + verify.stderr,
    expectedFingerprint,
  );
  if (!signer.ok) return signer;
  const objectSha = git(cwd, "rev-parse", ref);
  if (objectSha.status !== 0 || !/^[0-9a-f]{40}$/.test(objectSha.stdout.trim()))
    return { ok: false, error: `Could not resolve tag object SHA for ${tag}.` };
  return { ok: true, objectSha: objectSha.stdout.trim() };
}

#!/usr/bin/env node

/**
 * Validate npm pack --json output before recording the tarball in GITHUB_ENV.
 *
 * Env: RUNNER_TEMP (pack.json + tarball location), VERSION (validated release
 * version), PACKAGE_NAME (trusted constant), GITHUB_ENV (append target).
 *
 * Requires exactly one packed result whose filename is the exact expected
 * basename (no CR/LF, no path separators), a non-empty integrity, and a
 * resolved path directly under RUNNER_TEMP. Only then appends the safe
 * single-line PACKAGE_TARBALL value. Diagnostics to stderr, nonzero exit
 * otherwise; never writes GITHUB_ENV on failure.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const runDir = process.env.RUNNER_TEMP;
const version = process.env.VERSION;
const packageName = process.env.PACKAGE_NAME;
const envPath = process.env.GITHUB_ENV;
if (!runDir || !version || !packageName || !envPath) {
  fail("Missing RUNNER_TEMP, VERSION, PACKAGE_NAME, or GITHUB_ENV.");
}

let report;
try {
  report = JSON.parse(readFileSync(join(runDir, "pack.json"), "utf8"));
} catch (error) {
  fail(
    `Could not read pack.json: ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (!Array.isArray(report) || report.length !== 1) {
  fail("npm pack --json must return exactly one package result.");
}

const packed = report[0];
if (typeof packed.filename !== "string" || packed.filename.length === 0) {
  fail("packed.filename must be a non-empty string.");
}
if (/[\r\n]/.test(packed.filename)) {
  fail("packed.filename must not contain CR or LF.");
}
if (/[\\/]/.test(packed.filename)) {
  fail("packed.filename must not contain path separators.");
}

const expectedBase = packageName.replace(/^@/, "").split("/").join("-");
const expected = `${expectedBase}-${version}.tgz`;
if (packed.filename !== expected) {
  fail(
    `packed.filename ${JSON.stringify(
      packed.filename,
    )} does not match expected ${JSON.stringify(expected)}.`,
  );
}
if (typeof packed.integrity !== "string" || packed.integrity.length === 0) {
  fail("packed.integrity must be a non-empty string.");
}

const tarball = join(runDir, packed.filename);
if (dirname(resolve(tarball)) !== resolve(runDir)) {
  fail("Tarball path must resolve directly under RUNNER_TEMP.");
}

appendFileSync(envPath, `PACKAGE_TARBALL=${tarball}\n`);

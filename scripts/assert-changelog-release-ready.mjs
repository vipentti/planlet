#!/usr/bin/env node

/**
 * Changelog readiness checks for the current package version.
 *
 * Ordinary CI (no flags):
 *   Requires exactly one [Unreleased] section and at most one [pkg.version]
 *   section. A dated version section must use a real calendar date and
 *   non-empty notes. Malformed headings that mention Unreleased or the package
 *   version still count toward cardinality.
 *
 *   The date is deliberately NOT required to be today or later here. Once a
 *   version ships, its section keeps the date it shipped on, and package.json
 *   stays on that version until the next release is prepared; enforcing a
 *   future date in ordinary CI would turn main red the day after every release.
 *   Staleness is a release-time concern, enforced under --release-date below.
 *
 * Release verification:
 *   node scripts/assert-changelog-release-ready.mjs --release-date YYYY-MM-DD
 *   Requires exactly one Unreleased, exactly one correctly dated package
 *   version section matching --release-date with non-empty notes, and a
 *   --release-date that is today or later (UTC).
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isValidCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) return false;
  return instant.toISOString().slice(0, 10) === value;
}

const todayUtc = new Date().toISOString().slice(0, 10);

function assertNotPast(date, description) {
  if (date < todayUtc) {
    fail(`${description} ${date} is earlier than today ${todayUtc} (UTC).`);
  }
}

function hasNonEmptyNotes(sectionBody) {
  return /^\s*-\s+\S/m.test(sectionBody);
}

function assertValidDatedNotes(dated, sectionBody, label, version) {
  if (dated === undefined) {
    fail(`${label} [${version}] header must include - YYYY-MM-DD.`);
  }
  if (!isValidCalendarDate(dated)) {
    fail(`${label} ${version} date is not a valid calendar day: ${dated}`);
  }
  if (!hasNonEmptyNotes(sectionBody)) {
    fail(`${label} ${version} section is missing release notes.`);
  }
}

const releaseDateFlags = process.argv
  .slice(2)
  .filter(
    (arg) => arg === "--release-date" || arg.startsWith("--release-date="),
  );
if (releaseDateFlags.length > 1) {
  fail("Duplicate --release-date option.");
}

let values;
let positionals;
try {
  ({ values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "release-date": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (values.help) {
  console.log(
    `Usage: assert-changelog-release-ready.mjs [--release-date YYYY-MM-DD] [CHANGELOG.md] [package.json]`,
  );
  process.exit(0);
}

if (positionals.length > 2) {
  fail(
    "Too many positional arguments (expected at most CHANGELOG.md and package.json).",
  );
}

const releaseDate = values["release-date"];
const changelogPath =
  positionals[0] ?? fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const packagePath =
  positionals[1] ?? fileURLToPath(new URL("../package.json", import.meta.url));

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const changelog = readFileSync(changelogPath, "utf8");
const version = pkg.version;

if (typeof version !== "string" || version.length === 0) {
  fail("package.json version must be a non-empty string.");
}

const headings = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gm)];
const unreleased = headings.filter((match) => match[1] === "Unreleased");
const versionSections = headings.filter((match) => match[1] === version);

function sectionBodyAfter(headerMatch) {
  const start = headerMatch.index + headerMatch[0].length;
  const rest = changelog.slice(start);
  const next = rest.search(/\n## \[|\n\[[^\]]+\]:/);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function parseVersionSuffix(suffix) {
  if (suffix === undefined || suffix.trim() === "") {
    return { kind: "bare" };
  }
  const dated = /^ - (\d{4}-\d{2}-\d{2})$/.exec(suffix);
  if (dated) {
    return { kind: "dated", date: dated[1] };
  }
  return { kind: "malformed", raw: suffix };
}

if (unreleased.length !== 1) {
  fail(
    `Changelog must contain exactly one [Unreleased] section (found ${unreleased.length}).`,
  );
}
const unreleasedSuffix = parseVersionSuffix(unreleased[0][2]);
if (unreleasedSuffix.kind !== "bare") {
  fail(
    "Changelog [Unreleased] header must not include a date or trailing text.",
  );
}

if (versionSections.length > 1) {
  fail(
    `Changelog must contain at most one [${version}] section (found ${versionSections.length}).`,
  );
}

if (releaseDate !== undefined) {
  if (!isValidCalendarDate(releaseDate)) {
    fail(`--release-date is not a valid calendar day: ${releaseDate}`);
  }
  assertNotPast(releaseDate, "--release-date");
  if (versionSections.length !== 1) {
    fail(
      `Changelog must contain exactly one [${version}] section for release verification (found ${versionSections.length}).`,
    );
  }
}

if (versionSections.length === 0) {
  process.exit(0);
}

const sectionMatch = versionSections[0];
const suffix = parseVersionSuffix(sectionMatch[2]);
if (suffix.kind === "malformed") {
  fail(`Changelog [${version}] header has an invalid suffix:${suffix.raw}`);
}
const dated = suffix.kind === "dated" ? suffix.date : undefined;
assertValidDatedNotes(
  dated,
  sectionBodyAfter(sectionMatch),
  "Changelog",
  version,
);

if (releaseDate !== undefined && dated !== releaseDate) {
  fail(
    `--release-date ${releaseDate} does not match changelog ${version} date ${dated}.`,
  );
}

process.exit(0);

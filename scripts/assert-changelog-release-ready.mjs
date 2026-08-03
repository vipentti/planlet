#!/usr/bin/env node

/**
 * Changelog readiness checks for the unpublished 0.1.0 bootstrap.
 *
 * Ordinary CI (no flags):
 *   Requires exactly one [Unreleased] section and at most one [0.1.0]
 *   section. A dated [0.1.0] must use a real calendar date and non-empty
 *   notes. Does not require --release-date.
 *
 * Release verification:
 *   node scripts/assert-changelog-release-ready.mjs --release-date YYYY-MM-DD
 *   Requires package 0.1.0, exactly one Unreleased, exactly one dated [0.1.0]
 *   matching --release-date with non-empty notes.
 */

import { readFileSync } from "node:fs";
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

function hasNonEmptyNotes(sectionBody) {
  return /^\s*-\s+\S/m.test(sectionBody);
}

function assertValidDatedNotes(dated, sectionBody, label) {
  if (dated === undefined) {
    fail(`${label} [0.1.0] header must include - YYYY-MM-DD.`);
  }
  if (!isValidCalendarDate(dated)) {
    fail(`${label} 0.1.0 date is not a valid calendar day: ${dated}`);
  }
  if (!hasNonEmptyNotes(sectionBody)) {
    fail(`${label} 0.1.0 section is missing release notes.`);
  }
}

function parseArgs(argv) {
  let releaseDate;
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--release-date") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        fail("Missing value for --release-date");
      }
      releaseDate = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }
  return { releaseDate, positionals };
}

const { releaseDate, positionals } = parseArgs(process.argv.slice(2));
const changelogPath =
  positionals[0] ?? fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const packagePath =
  positionals[1] ?? fileURLToPath(new URL("../package.json", import.meta.url));

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const changelog = readFileSync(changelogPath, "utf8");

if (pkg.version !== "0.1.0") {
  if (releaseDate !== undefined) {
    fail(
      `Release verification requires package version 0.1.0 (found ${pkg.version}).`,
    );
  }
  process.exit(0);
}

const unreleasedMatches = [...changelog.matchAll(/^## \[Unreleased\]\s*$/gm)];
const versionMatches = [
  ...changelog.matchAll(/^## \[0\.1\.0\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/gm),
];

function sectionBodyAfter(headerMatch) {
  const start = headerMatch.index + headerMatch[0].length;
  const rest = changelog.slice(start);
  const next = rest.search(/\n## \[|\n\[[^\]]+\]:/);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

if (unreleasedMatches.length !== 1) {
  fail(
    `Changelog must contain exactly one [Unreleased] section (found ${unreleasedMatches.length}).`,
  );
}

if (releaseDate === undefined) {
  if (versionMatches.length > 1) {
    fail(
      `Changelog must contain at most one [0.1.0] section (found ${versionMatches.length}).`,
    );
  }
  if (versionMatches.length === 0) {
    process.exit(0);
  }
  const sectionMatch = versionMatches[0];
  assertValidDatedNotes(
    sectionMatch[1],
    sectionBodyAfter(sectionMatch),
    "Changelog",
  );
  process.exit(0);
}

if (!isValidCalendarDate(releaseDate)) {
  fail(`--release-date is not a valid calendar day: ${releaseDate}`);
}
if (versionMatches.length !== 1) {
  fail(
    `Changelog must contain exactly one [0.1.0] section for release verification (found ${versionMatches.length}).`,
  );
}
const sectionMatch = versionMatches[0];
assertValidDatedNotes(
  sectionMatch[1],
  sectionBodyAfter(sectionMatch),
  "Changelog",
);
if (sectionMatch[1] !== releaseDate) {
  fail(
    `--release-date ${releaseDate} does not match changelog 0.1.0 date ${sectionMatch[1]}.`,
  );
}

process.exit(0);

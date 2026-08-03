#!/usr/bin/env node

/**
 * Changelog readiness checks for the unpublished 0.1.0 bootstrap.
 *
 * Ordinary CI (no flags):
 *   Allows Unreleased-only notes, or a structurally valid dated [0.1.0]
 *   section. Does not require --release-date.
 *
 * Release verification:
 *   node scripts/assert-changelog-release-ready.mjs --release-date YYYY-MM-DD
 *   Requires package 0.1.0, Unreleased present, matching dated [0.1.0] with
 *   non-empty notes and a real calendar date.
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

const unreleasedPresent = /^## \[Unreleased\]\s*$/m.test(changelog);
const sectionMatch = /^## \[0\.1\.0\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/m.exec(
  changelog,
);

function sectionBodyAfter(headerMatch) {
  const start = headerMatch.index + headerMatch[0].length;
  const rest = changelog.slice(start);
  const next = rest.search(/\n## \[|\n\[[^\]]+\]:/);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

if (releaseDate === undefined) {
  // Ordinary CI: Unreleased-only is fine; a dated 0.1.0 must be structurally valid.
  if (sectionMatch === null) {
    process.exit(0);
  }
  const dated = sectionMatch[1];
  if (dated === undefined) {
    fail(
      "Changelog has [0.1.0] without a release date; set YYYY-MM-DD before bootstrap.",
    );
  }
  if (!isValidCalendarDate(dated)) {
    fail(`Changelog 0.1.0 date is not a valid calendar day: ${dated}`);
  }
  if (!hasNonEmptyNotes(sectionBodyAfter(sectionMatch))) {
    fail("Changelog 0.1.0 section is missing release notes.");
  }
  process.exit(0);
}

if (!isValidCalendarDate(releaseDate)) {
  fail(`--release-date is not a valid calendar day: ${releaseDate}`);
}
if (!unreleasedPresent) {
  fail(
    "Changelog must keep an [Unreleased] section during release verification.",
  );
}
if (sectionMatch === null) {
  fail(
    "Changelog is missing a [0.1.0] section required for release verification.",
  );
}
const dated = sectionMatch[1];
if (dated === undefined) {
  fail(
    "Changelog [0.1.0] header must include - YYYY-MM-DD for release verification.",
  );
}
if (!isValidCalendarDate(dated)) {
  fail(`Changelog 0.1.0 date is not a valid calendar day: ${dated}`);
}
if (dated !== releaseDate) {
  fail(
    `--release-date ${releaseDate} does not match changelog 0.1.0 date ${dated}.`,
  );
}
if (!hasNonEmptyNotes(sectionBodyAfter(sectionMatch))) {
  fail("Changelog 0.1.0 section is missing release notes.");
}

process.exit(0);

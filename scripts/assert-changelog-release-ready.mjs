#!/usr/bin/env node

/**
 * Changelog readiness checks for the current package version.
 *
 * Ordinary CI (no flags):
 *   Requires exactly one [Unreleased] section and at most one [pkg.version]
 *   section. A dated version section must use a real calendar date and
 *   non-empty notes. Every changelog section must have a link reference.
 *   Malformed headings that mention Unreleased or the package version still
 *   count toward cardinality.
 *
 * Release preparation and historical release validation are owned by
 * `npm-release-flow` (kit `todayUtc()`); this helper is ordinary structural
 * lint only and accepts no release flags.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function isValidCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) return false;
  return instant.toISOString().slice(0, 10) === value;
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

function main() {
  const allArgs = process.argv.slice(2);

  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: allArgs,
      options: {
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
      "Usage: assert-changelog-release-ready.mjs [CHANGELOG.md] [package.json]",
    );
    process.exit(0);
  }

  if (positionals.length > 2) {
    fail(
      "Too many positional arguments (expected at most CHANGELOG.md and package.json).",
    );
  }

  const changelogPath =
    positionals[0] ??
    fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
  const packagePath =
    positionals[1] ??
    fileURLToPath(new URL("../package.json", import.meta.url));

  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const changelog = readFileSync(changelogPath, "utf8");
  const version = pkg.version;

  if (typeof version !== "string" || version.length === 0) {
    fail("package.json version must be a non-empty string.");
  }

  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gm)];
  const unreleased = headings.filter((match) => match[1] === "Unreleased");
  const versionSections = headings.filter((match) => match[1] === version);
  const linkReferences = new Set(
    [...changelog.matchAll(/^\[([^\]]+)\]:[ \t]*\S.*$/gm)].map(
      (match) => match[1],
    ),
  );

  function assertLinkReferences() {
    const missing = [...new Set(headings.map((match) => match[1]))].filter(
      (label) => !linkReferences.has(label),
    );
    if (missing.length > 0) {
      fail(
        `Changelog is missing link reference(s): ${missing
          .map((label) => `[${label}]`)
          .join(", ")}.`,
      );
    }
  }

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

  assertLinkReferences();

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

  process.exit(0);
}

// Run the CLI only when invoked directly; importing this module for the shared
// helper must not execute argument parsing, file reads, or process.exit.
if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main();
}

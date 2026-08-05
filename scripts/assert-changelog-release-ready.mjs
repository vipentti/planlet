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
 *   Requires exactly one empty Unreleased section, exactly one correctly dated
 *   package version section matching --release-date with non-empty notes, and a
 *   --release-date that is today or later (UTC).
 *
 * Historical verification:
 *   node scripts/assert-changelog-release-ready.mjs --verify-release [--date YYYY-MM-DD] [--print-date] [CHANGELOG.md] [package.json]
 *   Validates a completed release section. No past-date rule.
 *   --print-date writes exactly YYYY-MM-DD\n to stdout on success, nothing else.
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

export function countFlags(args, prefix) {
  return args.filter((a) => a === prefix || a.startsWith(prefix + "=")).length;
}

export function packageLockMismatch(lock, version) {
  if (lock.version !== version)
    return (
      "package-lock.json.version is " + lock.version + ", expected " + version
    );
  const rootEntry = lock.packages?.[""];
  if (!rootEntry || typeof rootEntry !== "object")
    return 'package-lock.json.packages[""] is missing or not an object';
  if (rootEntry.version !== version)
    return (
      'package-lock.json.packages[""].version is ' +
      rootEntry.version +
      ", expected " +
      version
    );
  return null;
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

// --- Flag validation ---

function main() {
  const allArgs = process.argv.slice(2);

  const releaseDateCount = countFlags(allArgs, "--release-date");
  const verifyReleaseCount = countFlags(allArgs, "--verify-release");
  const printDateCount = countFlags(allArgs, "--print-date");
  const dateCount = countFlags(allArgs, "--date");

  if (releaseDateCount > 1) fail("Duplicate --release-date option.");
  if (verifyReleaseCount > 1) fail("Duplicate --verify-release option.");
  if (printDateCount > 1) fail("Duplicate --print-date option.");
  if (dateCount > 1) fail("Duplicate --date option.");

  const hasVerifyRelease = verifyReleaseCount === 1;

  if (dateCount === 1 && !hasVerifyRelease) {
    fail("--date requires --verify-release.");
  }
  if (printDateCount === 1 && !hasVerifyRelease) {
    fail("--print-date requires --verify-release.");
  }
  if (releaseDateCount === 1 && hasVerifyRelease) {
    fail("--release-date and --verify-release are mutually exclusive.");
  }

  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: allArgs,
      options: {
        "release-date": { type: "string" },
        "verify-release": { type: "boolean" },
        date: { type: "string" },
        "print-date": { type: "boolean" },
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
      `Usage: assert-changelog-release-ready.mjs [--release-date YYYY-MM-DD] [--verify-release [--date YYYY-MM-DD] [--print-date]] [CHANGELOG.md] [package.json]`,
    );
    process.exit(0);
  }

  if (positionals.length > 2) {
    fail(
      "Too many positional arguments (expected at most CHANGELOG.md and package.json).",
    );
  }

  const releaseDate = values["release-date"];
  const verifyRelease = values["verify-release"] ?? false;
  const histDate = values["date"];
  const printDate = values["print-date"] ?? false;

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

  function assertChangelogShape({ mode, version, releaseDate }) {
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

    if (mode === "preparation") {
      if (versionSections.length > 1) {
        fail(
          `Changelog must contain at most one [${version}] section (found ${versionSections.length}).`,
        );
      }
      if (!isValidCalendarDate(releaseDate)) {
        fail(`--release-date is not a valid calendar day: ${releaseDate}`);
      }
      assertNotPast(releaseDate, "--release-date");
      if (sectionBodyAfter(unreleased[0]) !== "") {
        fail(
          "Changelog [Unreleased] section must be empty for release verification (notes must be moved, not copied).",
        );
      }
      if (versionSections.length !== 1) {
        fail(
          `Changelog must contain exactly one [${version}] section for release verification (found ${versionSections.length}).`,
        );
      }
    } else if (mode === "ci") {
      if (versionSections.length > 1) {
        fail(
          `Changelog must contain at most one [${version}] section (found ${versionSections.length}).`,
        );
      }
      if (versionSections.length === 0) {
        return undefined;
      }
    } else {
      if (sectionBodyAfter(unreleased[0]) !== "") {
        fail(
          "Changelog [Unreleased] section must be empty for historical verification.",
        );
      }
      if (versionSections.length !== 1) {
        fail(
          `Changelog must contain exactly one [${version}] section (found ${versionSections.length}).`,
        );
      }
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

    if (mode === "preparation" && dated !== releaseDate) {
      fail(
        `--release-date ${releaseDate} does not match changelog ${version} date ${dated}.`,
      );
    }

    return dated;
  }

  // --- Historical mode ---

  if (verifyRelease) {
    const dated = assertChangelogShape({
      mode: "historical",
      version,
      releaseDate: undefined,
    });

    if (histDate !== undefined) {
      if (!isValidCalendarDate(histDate)) {
        fail(`--date is not a valid calendar day: ${histDate}`);
      }
      if (dated !== histDate) {
        fail(
          `Changelog ${version} date ${dated} does not match --date ${histDate}.`,
        );
      }
    }

    if (printDate) {
      if (dated === undefined) {
        fail("Cannot print date: changelog section has no date.");
      }
      console.log(dated);
    }

    process.exit(0);
  }

  // --- Preparation mode (--release-date) or plain CI ---

  assertChangelogShape({
    mode: releaseDate === undefined ? "ci" : "preparation",
    version,
    releaseDate,
  });

  process.exit(0);
}

// Run the CLI only when invoked directly; importing this module for the shared
// helpers must not execute argument parsing, file reads, or process.exit.
if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main();
}

#!/usr/bin/env node

/**
 * Blocks packing an already-dated 0.1.0 changelog while the package is still
 * unpublished, unless PLANLET_RELEASE_DATE equals that header date.
 *
 * Before approving the bootstrap SHA, set the [0.1.0] header to the intended
 * publish day and run with PLANLET_RELEASE_DATE=YYYY-MM-DD.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const changelogPath =
  process.argv[2] ?? fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const packagePath =
  process.argv[3] ?? fileURLToPath(new URL("../package.json", import.meta.url));

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const changelog = readFileSync(changelogPath, "utf8");
const intended = process.env.PLANLET_RELEASE_DATE?.trim();

if (pkg.version !== "0.1.0") {
  process.exit(0);
}

const match = /^## \[0\.1\.0\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/m.exec(changelog);
if (match === null) {
  // Notes may still live under Unreleased until the captain dates 0.1.0.
  process.exit(0);
}

const dated = match[1];
if (dated === undefined) {
  console.error(
    "Changelog has [0.1.0] without a release date; set YYYY-MM-DD before bootstrap.",
  );
  process.exit(1);
}

if (intended === undefined || intended.length === 0) {
  console.error(
    `Changelog dates 0.1.0 as ${dated}, but PLANLET_RELEASE_DATE is unset.`,
  );
  console.error(
    "Keep 0.1.0 notes under Unreleased until publish day, or export PLANLET_RELEASE_DATE=YYYY-MM-DD matching the header.",
  );
  process.exit(1);
}

if (intended !== dated) {
  console.error(
    `PLANLET_RELEASE_DATE=${intended} does not match changelog 0.1.0 date ${dated}.`,
  );
  process.exit(1);
}

process.exit(0);

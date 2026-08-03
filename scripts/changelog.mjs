#!/usr/bin/env node

import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version || version === "Unreleased") {
  console.error(`Invalid changelog version: ${version ?? "(missing)"}`);
  process.exit(1);
}

const changelog = readFileSync(
  process.argv[3] ?? new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
);
const section = changelog
  .split(/\n## /)
  .find((entry) => entry.startsWith(`[${version}] - `))
  ?.split(/\n\[[^\]]+\]:/)[0];
const notes = section?.split("\n").slice(1).join("\n").trim() ?? "";
if (!notes || !/^\s*-\s+\S/m.test(notes)) {
  console.error(`Missing or empty changelog section: ${version}`);
  process.exit(1);
}

console.log(notes);

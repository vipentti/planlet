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
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const match = `${changelog}\n## `.match(
  new RegExp(
    `^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}[ \\t]*$([\\s\\S]*?)(?=^## |^\\[[^\\]]+\\]:)`,
    "m",
  ),
);
const notes = match?.[1]?.trim();
if (!notes || !/^\s*-\s+\S/m.test(notes)) {
  console.error(`Missing or empty changelog section: ${version}`);
  process.exit(1);
}

console.log(notes);

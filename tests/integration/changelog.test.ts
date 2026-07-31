import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(root, "scripts", "changelog.mjs");
const fixture = join(root, "tests", "fixtures", "changelog.md");

function extract(version: string) {
  return spawnSync(process.execPath, [script, version, fixture], {
    encoding: "utf8",
  });
}

test("extracts one non-empty version and rejects invalid sections", () => {
  const known = extract("1.2.3");
  assert.equal(known.status, 0, known.stderr);
  assert.equal(
    known.stdout,
    "### Added\n\n- Known change\n\n### Fixed\n\n- Known fix\n",
  );

  for (const version of ["9.9.9", "2.0.0", "Unreleased"]) {
    const result = extract(version);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(version.replace(".", "\\.")));
  }
});

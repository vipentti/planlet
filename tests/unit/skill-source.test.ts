import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  enumerateCanonicalSkills,
  resolveCanonicalSkillsPath,
  sha256,
} from "../../src/core/skill-source.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

test("development module location resolves and enumerates canonical skills", () => {
  const root = resolveCanonicalSkillsPath(
    pathToFileURL(join(process.cwd(), "src", "core", "skill-source.ts")).href,
  );
  const source = enumerateCanonicalSkills(root);

  assert.deepEqual(source.skills, [
    "planlet-complete",
    "planlet-implement",
    "planlet-plan",
  ]);
  assert.ok(source.files.length > source.skills.length);
  assert.deepEqual(
    source.files.map((file) => file.relativePath),
    [...source.files.map((file) => file.relativePath)].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
  for (const file of source.files) {
    assert.equal(file.digest, sha256(file.content));
  }
});

test("bundled module location resolves sibling canonical skills", () => {
  assert.equal(
    resolveCanonicalSkillsPath(
      pathToFileURL(join(process.cwd(), "dist", "planlet.mjs")).href,
    ),
    resolveCanonicalSkillsPath(),
  );
});

test("canonical source probing reports non-missing filesystem failures", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-probe-"));
  try {
    writeFileSync(join(root, "skills"), "not a directory\n");
    mkdirSync(join(root, "src", "skills", "planlet-example"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "src", "skills", "planlet-example", "SKILL.md"),
      "# Example\n",
    );

    assert.throws(
      () =>
        resolveCanonicalSkillsPath(
          pathToFileURL(join(root, "src", "core", "skill-source.ts")).href,
        ),
      (error) =>
        error instanceof PlanletError &&
        error.code === "write_conflict" &&
        error.message.includes(join(root, "skills")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical enumeration rejects source symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-source-"));
  const outside = mkdtempSync(join(tmpdir(), "planlet-source-outside-"));
  try {
    mkdirSync(join(root, "planlet-example"));
    writeFileSync(join(root, "planlet-example", "SKILL.md"), "# Example\n");
    writeFileSync(join(outside, "extra.md"), "outside\n");
    symlinkSync(
      join(outside, "extra.md"),
      join(root, "planlet-example", "extra.md"),
    );

    assert.throws(
      () => enumerateCanonicalSkills(root),
      (error) => error instanceof PlanletError && error.code === "unsafe_path",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("canonical enumeration reports a missing source", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-missing-"));
  rmSync(root, { recursive: true, force: true });
  try {
    assert.throws(
      () => enumerateCanonicalSkills(root),
      (error) =>
        error instanceof PlanletError &&
        error.code === "write_conflict" &&
        error.message.includes("Cannot resolve canonical skill source") &&
        error.message.includes(root),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical enumeration reports a source that cannot be enumerated", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-file-"));
  try {
    const file = join(root, "skills-file");
    writeFileSync(file, "# Not a directory\n");

    assert.throws(
      () => enumerateCanonicalSkills(file),
      (error) =>
        error instanceof PlanletError &&
        error.code === "write_conflict" &&
        error.message.includes("Cannot enumerate canonical skill source") &&
        error.message.includes(file),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

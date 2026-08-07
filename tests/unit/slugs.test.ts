import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveDateFromInstant,
  assertValidArchiveName,
  assertValidSlug,
  createArchiveName,
  isRealArchiveDate,
  isValidSlug,
  parseArchiveName,
} from "../../src/core/plan/slugs.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

test("slug validation accepts descriptive lowercase kebab-case names", () => {
  for (const slug of ["cli-core", "phase2", "v2-parser", "a"]) {
    assert.equal(isValidSlug(slug), true, slug);
    assert.equal(assertValidSlug(slug), slug);
  }
});

test("slug validation rejects unsafe or non-descriptive names", () => {
  for (const slug of [
    "",
    "CLI-core",
    "cli_core",
    "cli core",
    "cli--core",
    "-cli",
    "cli-",
    ".",
    "..",
    "../cli",
    "plans/cli",
    "123",
  ]) {
    assert.equal(isValidSlug(slug), false, slug);
  }

  assert.throws(
    () => assertValidSlug("../cli"),
    (error) => error instanceof PlanletError && error.code === "invalid_slug",
  );
});

test("archive names expose a real date and the unchanged logical slug", () => {
  assert.deepEqual(parseArchiveName("2024-02-29-cli-core"), {
    archiveName: "2024-02-29-cli-core",
    archiveDate: "2024-02-29",
    slug: "cli-core",
  });
  assert.equal(isRealArchiveDate("2024-02-29"), true);
  assert.equal(isRealArchiveDate("2023-02-29"), false);
  assert.equal(parseArchiveName("2023-02-29-cli-core"), null);
  assert.equal(parseArchiveName("2024-01-01-CLI-core"), null);
  assert.equal(parseArchiveName("cli-core"), null);
});

test("invalid archive names produce structured invalid-plan errors", () => {
  assert.throws(
    () => assertValidArchiveName("2026-13-01-cli-core"),
    (error) => error instanceof PlanletError && error.code === "invalid_plan",
  );
});

test("archive dates are derived from the same UTC instant", () => {
  const instant = new Date("2026-07-22T23:59:59.999Z");
  assert.equal(archiveDateFromInstant(instant), "2026-07-22");
  assert.equal(createArchiveName("cli-core", instant), "2026-07-22-cli-core");

  assert.throws(
    () => archiveDateFromInstant(new Date(Number.NaN)),
    (error) => error instanceof PlanletError && error.code === "invalid_plan",
  );
});

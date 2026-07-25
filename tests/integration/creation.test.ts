import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPlanlet, deriveTitleFromSlug } from "../../src/core/creation.js";
import { validatePlanletStructure } from "../../src/core/validation.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withRepository(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-creation-"));
  mkdirSync(join(root, ".git"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readStub(root: string, slug: string, filename: string): string {
  return readFileSync(join(root, "plans", slug, filename), "utf8");
}

test("creation initializes plans and publishes exactly two derived-title stubs", () => {
  withRepository((root) => {
    const summary = createPlanlet({
      repositoryRoot: root,
      slug: "api-v2-core",
    });
    const directory = join(realpathSync(root), "plans", "api-v2-core");

    assert.equal(deriveTitleFromSlug("api-v2-core"), "Api V2 Core");
    assert.deepEqual(readdirSync(directory).sort(), ["plan.md", "tasks.md"]);
    assert.equal(readStub(root, "api-v2-core", "plan.md"), "# Api V2 Core\n");
    assert.equal(
      readStub(root, "api-v2-core", "tasks.md"),
      "# Tasks: Api V2 Core\n",
    );
    assert.deepEqual(summary, {
      slug: "api-v2-core",
      title: "Api V2 Core",
      state: "draft",
      completedTasks: 0,
      totalTasks: 0,
      path: directory,
      warnings: [],
    });

    const validated = validatePlanletStructure({
      directoryName: "api-v2-core",
      location: "active",
      planMarkdown: readStub(root, "api-v2-core", "plan.md"),
      tasksMarkdown: readStub(root, "api-v2-core", "tasks.md"),
    });
    assert.equal(validated.state, "draft");
    assert.deepEqual(validated.tasks, []);
  });
});

test("creation trims explicit titles and rejects empty or multiline titles", () => {
  withRepository((root) => {
    createPlanlet({
      repositoryRoot: root,
      slug: "custom-title",
      title: "  Custom API Title  ",
    });
    assert.equal(
      readStub(root, "custom-title", "plan.md"),
      "# Custom API Title\n",
    );
    assert.equal(
      readStub(root, "custom-title", "tasks.md"),
      "# Tasks: Custom API Title\n",
    );
  });

  for (const title of ["   ", "First line\nSecond line", "First\rSecond"]) {
    withRepository((root) => {
      assert.throws(
        () => createPlanlet({ repositoryRoot: root, slug: "bad-title", title }),
        (error) =>
          error instanceof PlanletError && error.code === "invalid_plan",
      );
      assert.equal(readdirSync(root).includes("plans"), false);
    });
  }
});

test("creation refuses active and completed logical-slug collisions", () => {
  withRepository((root) => {
    createPlanlet({ repositoryRoot: root, slug: "existing-plan" });
    assert.throws(
      () => createPlanlet({ repositoryRoot: root, slug: "existing-plan" }),
      (error) =>
        error instanceof PlanletError && error.code === "plan_already_exists",
    );
  });

  withRepository((root) => {
    mkdirSync(join(root, "plans", "completed", "2026-07-22-existing-plan"), {
      recursive: true,
    });
    assert.throws(
      () => createPlanlet({ repositoryRoot: root, slug: "existing-plan" }),
      (error) =>
        error instanceof PlanletError && error.code === "completed_plan_exists",
    );
    assert.equal(
      readdirSync(join(root, "plans")).includes("existing-plan"),
      false,
    );
  });
});

test("creation removes its temporary directory after a partial write failure", () => {
  withRepository((root) => {
    let writes = 0;
    assert.throws(
      () =>
        createPlanlet({
          repositoryRoot: root,
          slug: "partial-failure",
          dependencies: {
            temporaryName: () => ".partial-failure.create-fixture",
            writeFile: (path, content) => {
              writes += 1;
              if (writes === 2) {
                throw new Error("simulated tasks.md failure");
              }
              writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
            },
          },
        }),
      (error) =>
        error instanceof PlanletError && error.code === "write_conflict",
    );

    assert.equal(writes, 2);
    assert.deepEqual(readdirSync(join(root, "plans")), []);
  });
});

test("creation translates cleanup failures without masking the creation failure", () => {
  withRepository((root) => {
    const writeFailure = new Error("simulated write failure");
    const cleanupFailure = new Error("simulated cleanup failure");
    const temporaryName = ".cleanup-failure.create-fixture";

    assert.throws(
      () =>
        createPlanlet({
          repositoryRoot: root,
          slug: "cleanup-failure",
          dependencies: {
            temporaryName: () => temporaryName,
            writeFile: () => {
              throw writeFailure;
            },
            remove: () => {
              throw cleanupFailure;
            },
          },
        }),
      (error) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "write_conflict");
        assert.deepEqual(error.details, {
          slug: "cleanup-failure",
          temporaryPath: join(realpathSync(root), "plans", temporaryName),
          cleanupFailed: true,
        });
        assert.ok(error.cause instanceof AggregateError);

        const [creationCause, preservedCleanupFailure] = error.cause.errors;
        assert.ok(creationCause instanceof PlanletError);
        assert.equal(creationCause.code, "write_conflict");
        assert.equal(creationCause.cause, writeFailure);
        assert.equal(preservedCleanupFailure, cleanupFailure);
        return true;
      },
    );

    assert.deepEqual(readdirSync(join(root, "plans")), [temporaryName]);
  });
});

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveSafePath } from "../../src/core/paths.js";
import { discoverRepositoryRoot } from "../../src/core/repository.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withTempDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "planlet-unit-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("repository discovery walks from nested directories to a .git marker", () => {
  withTempDirectory((directory) => {
    mkdirSync(join(directory, ".git"));
    const nested = join(directory, "packages", "app");
    mkdirSync(nested, { recursive: true });

    assert.equal(
      discoverRepositoryRoot({ startPath: nested }),
      realpathSync(directory),
    );
  });
});

test("explicit roots and unmarked current-directory fallbacks are supported", () => {
  withTempDirectory((directory) => {
    assert.equal(
      discoverRepositoryRoot({
        startPath: tmpdir(),
        explicitRoot: directory,
      }),
      realpathSync(directory),
    );

    mkdirSync(join(directory, "plans"));
    assert.equal(
      discoverRepositoryRoot({ startPath: directory }),
      realpathSync(directory),
    );
  });
});

test("repository discovery reports a structured error when no root exists", () => {
  withTempDirectory((directory) => {
    assert.throws(
      () => discoverRepositoryRoot({ startPath: directory }),
      (error) =>
        error instanceof PlanletError && error.code === "repo_not_found",
    );
  });
});

test("safe path resolution accepts existing and not-yet-created paths", () => {
  withTempDirectory((directory) => {
    mkdirSync(join(directory, "plans"));
    assert.equal(
      resolveSafePath(directory, "plans", "cli-core"),
      join(realpathSync(directory), "plans", "cli-core"),
    );
  });
});

test("safe path resolution rejects absolute paths and traversal", () => {
  withTempDirectory((directory) => {
    for (const segments of [["..", "outside"], [join(directory, "absolute")]]) {
      assert.throws(
        () => resolveSafePath(directory, ...segments),
        (error) =>
          error instanceof PlanletError && error.code === "unsafe_path",
      );
    }
  });
});

test("safe path resolution rejects existing symlinks that escape the root", () => {
  withTempDirectory((directory) => {
    withTempDirectory((outside) => {
      writeFileSync(join(outside, "tasks.md"), "# Outside\n");
      symlinkSync(outside, join(directory, "escape"));

      assert.throws(
        () => resolveSafePath(directory, "escape", "tasks.md"),
        (error) =>
          error instanceof PlanletError && error.code === "unsafe_path",
      );
    });
  });
});

test("safe path resolution rejects broken symlinks", () => {
  withTempDirectory((directory) => {
    symlinkSync(
      join(directory, "missing-target"),
      join(directory, "broken-link"),
    );

    assert.throws(
      () => resolveSafePath(directory, "broken-link", "tasks.md"),
      (error) => error instanceof PlanletError && error.code === "unsafe_path",
    );
  });
});

test("safe path resolution permits symlinks whose targets remain inside", () => {
  withTempDirectory((directory) => {
    const plans = join(directory, "plans");
    mkdirSync(plans);
    symlinkSync(plans, join(directory, "plans-link"));

    assert.equal(
      resolveSafePath(directory, "plans-link", "cli-core"),
      join(realpathSync(directory), "plans", "cli-core"),
    );
  });
});

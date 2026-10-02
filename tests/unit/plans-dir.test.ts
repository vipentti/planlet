import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_PLANS_DIR,
  assertValidPlansDir,
  hasPlansLayoutMarker,
  plansDirPathspec,
  readPlansDir,
  requirePlansDirectory,
  resolvePlansLocation,
  type PlansDirDependencies,
} from "../../src/core/plans-dir.js";
import { PlanletError } from "../../src/errors/planlet-error.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "planlet-plans-dir-"));
  try {
    run(realpathSync(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeConfig(root: string, body: string): void {
  writeFileSync(join(root, ".planlet.json"), body, { encoding: "utf8" });
}

test("absent config uses plans/", () => {
  withRoot((root) => {
    mkdirSync(join(root, "plans"));
    assert.equal(readPlansDir(root), DEFAULT_PLANS_DIR);
    assert.deepEqual(resolvePlansLocation(root), {
      plansDir: "plans",
      plansPath: join(root, "plans"),
    });
    assert.equal(requirePlansDirectory(root).plansDir, "plans");
    assert.equal(plansDirPathspec("plans"), "plans/");
  });
});

test("unknown JSON keys are ignored and omitted plansDir means plans/", () => {
  withRoot((root) => {
    mkdirSync(join(root, "plans"));
    writeConfig(
      root,
      JSON.stringify({ futureKey: true, extra: { nested: 1 } }),
    );
    assert.equal(readPlansDir(root), "plans");
  });
});

test("valid plansDir selects a two-segment directory", () => {
  withRoot((root) => {
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans", extra: "ok" }));
    const location = requirePlansDirectory(root);
    assert.equal(location.plansDir, "docs/plans");
    assert.equal(location.plansPath, join(root, "docs", "plans"));
    assert.equal(plansDirPathspec(location.plansDir), "docs/plans/");
  });
});

test("reserved YAML and rc filenames are invalid_config", () => {
  withRoot((root) => {
    writeFileSync(join(root, ".planlet.yaml"), "plansDir: docs/plans\n");
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "invalid_config");
        assert.match(error.message, /YAML/);
        return true;
      },
    );
  });

  withRoot((root) => {
    writeFileSync(join(root, ".planlet.yml"), "plansDir: docs/plans\n");
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });

  withRoot((root) => {
    writeFileSync(join(root, ".planletrc.json"), "{}\n");
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "invalid_config");
        assert.match(error.message, /Unrecognized/);
        return true;
      },
    );
  });

  withRoot((root) => {
    writeFileSync(join(root, ".planlet.config.json"), "{}\n");
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "invalid_config");
        assert.match(error.message, /Multiple Planlet config files/);
        return true;
      },
    );
  });
});

test("a visible planlet.json is not read", () => {
  withRoot((root) => {
    mkdirSync(join(root, "plans"));
    writeFileSync(
      join(root, "planlet.json"),
      JSON.stringify({ plansDir: "docs/plans" }),
    );
    assert.equal(readPlansDir(root), "plans");
  });
});

test("invalid JSON and non-object documents fail closed", () => {
  withRoot((root) => {
    writeConfig(root, "{");
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });

  withRoot((root) => {
    writeConfig(root, "[]");
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });

  withRoot((root) => {
    writeConfig(root, JSON.stringify({ plansDir: 1 }));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("a directory at .planlet.json is invalid_config", () => {
  withRoot((root) => {
    mkdirSync(join(root, ".planlet.json"));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("plansDir traversal, globs, and empty segments fail closed", () => {
  for (const value of [
    "..",
    "../plans",
    "docs/../plans",
    "/abs",
    "docs/plans/",
    "docs\\plans",
    "docs/plans extra",
    "docs/plans*",
    ".",
    "",
    "plans/custom",
    "Plans/custom",
    "PLANS",
    ".git",
    ".planlet.json",
    ".planlet.yaml",
    "docs/.git/plans",
    "docs/.GIT/plans",
    ".agents.",
    "AGENTS.md.",
    "NUL",
    "con.txt",
    "docs/COM1/plans",
  ]) {
    assert.throws(
      () => assertValidPlansDir(value),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
      value,
    );
  }

  withRoot((root) => {
    writeConfig(root, JSON.stringify({ plansDir: ".." }));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("leftover plans/ with nested directories is plans_dir_conflict", () => {
  withRoot((root) => {
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    mkdirSync(join(root, "plans", "old-plan"), { recursive: true });
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "plans_dir_conflict");
        return true;
      },
    );
  });
});

test("a leftover plans/ symlink to an in-repository tree is plans_dir_conflict", () => {
  withRoot((root) => {
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    mkdirSync(join(root, "store", "old-plan"), { recursive: true });
    symlinkSync(join(root, "store"), join(root, "plans"));
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "plans_dir_conflict");
        return true;
      },
    );
  });
});

test("empty leftover plans/ is not a conflict", () => {
  withRoot((root) => {
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    mkdirSync(join(root, "plans"));
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.equal(readPlansDir(root), "docs/plans");
  });
});

test("a case-only config filename is invalid_config", () => {
  withRoot((root) => {
    writeFileSync(
      join(root, ".PLANLET.JSON"),
      JSON.stringify({ plansDir: "docs/plans" }),
    );
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("an existing directory case alias is invalid_config", () => {
  withRoot((root) => {
    mkdirSync(join(root, "docs"));
    writeConfig(root, JSON.stringify({ plansDir: "Docs/plans" }));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("missing configured directory is plans_not_initialized after a successful parse", () => {
  withRoot((root) => {
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.equal(readPlansDir(root), "docs/plans");
    assert.throws(
      () => requirePlansDirectory(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "plans_not_initialized",
    );
  });
});

test("a config symlink that escapes the root is invalid_config", () => {
  withRoot((root) => {
    withRoot((outside) => {
      writeFileSync(
        join(outside, "config.json"),
        JSON.stringify({ plansDir: "docs/plans" }),
      );
      symlinkSync(join(outside, "config.json"), join(root, ".planlet.json"));
      assert.throws(
        () => readPlansDir(root),
        (error: unknown) =>
          error instanceof PlanletError && error.code === "invalid_config",
      );
    });
  });
});

test("an in-repository config symlink is invalid_config", () => {
  withRoot((root) => {
    writeFileSync(
      join(root, "actual.json"),
      JSON.stringify({ plansDir: "docs/plans" }),
    );
    symlinkSync(join(root, "actual.json"), join(root, ".planlet.json"));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("a plansDir path with a symlink component is invalid_config", () => {
  withRoot((root) => {
    mkdirSync(join(root, "store", "plans"), { recursive: true });
    symlinkSync(join(root, "store"), join(root, "docs"));
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.throws(
      () => readPlansDir(root),
      (error: unknown) => {
        assert.ok(error instanceof PlanletError);
        assert.equal(error.code, "invalid_config");
        assert.match(error.message, /symlink/);
        return true;
      },
    );
  });
});

test("absent config still accepts an in-repository plans/ symlink", () => {
  withRoot((root) => {
    const store = join(root, "store");
    mkdirSync(store);
    symlinkSync(store, join(root, "plans"));
    assert.equal(readPlansDir(root), "plans");
    assert.equal(requirePlansDirectory(root).plansPath, realpathSync(store));
  });
});

function errnoError(code: string, path: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: ${path}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("an unlistable repository root is invalid_config, not a silent plans/ fallback", () => {
  withRoot((root) => {
    mkdirSync(join(root, "plans"));
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    for (const code of ["EACCES", "EIO", "ENOTDIR"]) {
      const blocked: PlansDirDependencies = {
        listNames: () => {
          throw errnoError(code, root);
        },
      };
      assert.throws(
        () => readPlansDir(root, blocked),
        (error: unknown) =>
          error instanceof PlanletError && error.code === "invalid_config",
        code,
      );
    }
    assert.throws(
      () =>
        hasPlansLayoutMarker(root, {
          listNames: () => {
            throw errnoError("EACCES", root);
          },
        }),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("an unlistable plansDir component is invalid_config, not skipped validation", () => {
  withRoot((root) => {
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    const docs = join(root, "docs");
    assert.throws(
      () =>
        readPlansDir(root, {
          listNames: (directory) => {
            if (directory === docs) {
              throw errnoError("EACCES", docs);
            }
            return readdirSync(directory);
          },
        }),
      (error: unknown) =>
        error instanceof PlanletError && error.code === "invalid_config",
    );
  });
});

test("a missing plansDir parent remains absent after a successful listing of the root", () => {
  withRoot((root) => {
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.equal(
      readPlansDir(root, {
        listNames: (directory) => {
          if (directory === join(root, "docs")) {
            throw errnoError("ENOENT", directory);
          }
          return readdirSync(directory);
        },
      }),
      "docs/plans",
    );
  });
});

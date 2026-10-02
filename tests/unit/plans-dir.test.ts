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

import {
  DEFAULT_PLANS_DIR,
  assertValidPlansDir,
  plansDirPathspec,
  readPlansDir,
  requirePlansDirectory,
  resolvePlansLocation,
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

test("empty leftover plans/ is not a conflict", () => {
  withRoot((root) => {
    mkdirSync(join(root, "docs", "plans"), { recursive: true });
    mkdirSync(join(root, "plans"));
    writeConfig(root, JSON.stringify({ plansDir: "docs/plans" }));
    assert.equal(readPlansDir(root), "docs/plans");
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

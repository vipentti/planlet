import assert from "node:assert/strict";
import {
  chmodSync,
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

import { decode } from "@toon-format/toon";

import {
  handleCreate,
  handleShow,
  handleTasks,
  handleValidate,
  type ExecutionContext,
} from "../../src/commands/handlers.js";
import type { ExitCode } from "../../src/errors/codes.js";

const COMPLETE_PLAN =
  "# Fixture\n\n## Summary\nFixture.\n\n## Scope\nFixture.\n\n## Approach\nFixture.\n\n## Acceptance Criteria\n- Works.\n\n## Verification\nTests.\n";

interface CommandOutcome {
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

type SlugCommand = (slug: string) => (context: ExecutionContext) => ExitCode;

/** The four commands this cross-cutting safety pass covers. */
const SLUG_COMMANDS: Readonly<Record<string, SlugCommand>> = Object.freeze({
  create: (slug) => (context) => handleCreate({ slug }, context),
  show: (slug) => (context) => handleShow({ slug }, context),
  validate: (slug) => (context) => handleValidate({ slug }, context),
  tasks: (slug) => (context) => handleTasks({ slug }, context),
});

function withRepository(
  run: (root: string, outside: string) => void,
  options: { readonly plans?: boolean } = {},
): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "planlet-safety-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "planlet-escape-")));
  mkdirSync(join(root, ".git"));
  if (options.plans !== false) {
    mkdirSync(join(root, "plans"));
  }
  try {
    run(root, outside);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

function writePlanlet(
  root: string,
  slug: string,
  files: { readonly plan?: string; readonly tasks?: string },
): string {
  const directory = join(root, "plans", slug);
  mkdirSync(directory, { recursive: true });
  if (files.plan !== undefined) {
    writeFileSync(join(directory, "plan.md"), files.plan);
  }
  if (files.tasks !== undefined) {
    writeFileSync(join(directory, "tasks.md"), files.tasks);
  }
  return directory;
}

function run(
  root: string,
  invoke: (context: ExecutionContext) => ExitCode,
): CommandOutcome {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = invoke({
    root,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    clock: () => new Date("2028-03-04T05:06:07Z"),
  });
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

function errorCode(outcome: CommandOutcome): string {
  const decoded = decode(outcome.stderr.trimEnd()) as {
    error?: { code?: unknown };
  };
  return String(decoded.error?.code);
}

function validationErrorCodes(outcome: CommandOutcome): readonly string[] {
  const decoded = decode(outcome.stdout.trimEnd()) as {
    entries?: ReadonlyArray<{ valid?: boolean; error?: { code?: unknown } }>;
  };
  return (decoded.entries ?? []).map((entry) => String(entry.error?.code));
}

test("unsafe and traversing slugs are refused by create, show, validate, and tasks", () => {
  const unsafeSlugs = [
    "..",
    "../escape",
    "../../etc",
    "nested/slug",
    "plans/../../escape",
    "/absolute",
    "with space",
    "Upper-Case",
    "trailing-",
    ".hidden",
    "",
  ];

  for (const [name, command] of Object.entries(SLUG_COMMANDS)) {
    withRepository((root, outside) => {
      for (const slug of unsafeSlugs) {
        const outcome = run(root, command(slug));
        assert.equal(
          outcome.exitCode,
          2,
          `${name} ${slug} should exit with the usage category`,
        );
        assert.equal(errorCode(outcome), "invalid_slug", `${name} ${slug}`);
        assert.equal(outcome.stdout, "", `${name} ${slug}`);
      }

      // No traversing slug may write inside or outside the repository.
      assert.deepEqual(readdirSync(join(root, "plans")), []);
      assert.deepEqual(readdirSync(outside), []);
    });
  }
});

test("malformed planlet structures fail read-only commands with plan-level errors", () => {
  const malformed = [
    {
      slug: "missing-tasks",
      files: { plan: "# Missing Tasks\n" },
      code: "invalid_plan",
    },
    {
      slug: "missing-plan",
      files: { tasks: "# Tasks: Missing Plan\n" },
      code: "invalid_plan",
    },
    {
      slug: "no-heading",
      files: { plan: "Not a heading\n", tasks: "# Tasks: No Heading\n" },
      code: "invalid_plan",
    },
    {
      slug: "malformed-task",
      files: {
        plan: "# Malformed Task\n",
        tasks: "# Tasks: Malformed Task\n\n- [ ] missing an identifier\n",
      },
      code: "invalid_plan",
    },
    {
      slug: "duplicate-ids",
      files: {
        plan: "# Duplicate Ids\n",
        tasks: "# Tasks: Duplicate Ids\n\n- [ ] T1 First\n- [x] T1 Second\n",
      },
      code: "duplicate_task_id",
    },
  ] as const;

  for (const entry of malformed) {
    withRepository((root) => {
      writePlanlet(root, entry.slug, entry.files);

      for (const command of ["show", "tasks"] as const) {
        const outcome = run(root, SLUG_COMMANDS[command]!(entry.slug));
        assert.equal(outcome.exitCode, 3, `${command} ${entry.slug}`);
        assert.equal(
          errorCode(outcome),
          entry.code,
          `${command} ${entry.slug}`,
        );
        assert.equal(outcome.stdout, "", `${command} ${entry.slug}`);
      }

      // validate reports malformed structures as data rather than throwing.
      const validated = run(root, SLUG_COMMANDS.validate!(entry.slug));
      assert.equal(validated.exitCode, 3, `validate ${entry.slug}`);
      assert.deepEqual(validationErrorCodes(validated), [entry.code]);
    });
  }
});

test("validate reports a malformed active directory name without escaping it", () => {
  withRepository((root) => {
    writePlanlet(root, "Bad_Slug", {
      plan: "# Bad Slug\n",
      tasks: "# Tasks: Bad Slug\n",
    });

    const outcome = run(root, (context) => handleValidate({}, context));
    assert.equal(outcome.exitCode, 3);
    assert.deepEqual(validationErrorCodes(outcome), ["invalid_plan"]);
  });
});

test("a plans directory symlinked outside the repository is refused", () => {
  withRepository(
    (root, outside) => {
      symlinkSync(outside, join(root, "plans"), "dir");

      for (const [name, command] of Object.entries(SLUG_COMMANDS)) {
        const outcome = run(root, command("escaped-plan"));
        assert.equal(outcome.exitCode, 5, name);
        assert.equal(errorCode(outcome), "unsafe_path", name);
        assert.equal(outcome.stdout, "", name);
      }

      assert.deepEqual(readdirSync(outside), []);
    },
    { plans: false },
  );
});

test("a planlet directory symlinked outside the repository is refused", () => {
  withRepository((root, outside) => {
    mkdirSync(join(outside, "escaped-plan"));
    writeFileSync(join(outside, "escaped-plan", "plan.md"), "# Escaped Plan\n");
    writeFileSync(
      join(outside, "escaped-plan", "tasks.md"),
      "# Tasks: Escaped Plan\n\n- [ ] T1 Escape\n",
    );
    symlinkSync(
      join(outside, "escaped-plan"),
      join(root, "plans", "escaped-plan"),
      "dir",
    );

    for (const [name, command] of Object.entries(SLUG_COMMANDS)) {
      const outcome = run(root, command("escaped-plan"));
      if (name === "validate") {
        assert.equal(outcome.exitCode, 3, name);
        assert.deepEqual(validationErrorCodes(outcome), ["unsafe_path"], name);
      } else {
        assert.equal(outcome.exitCode, 5, name);
        assert.equal(errorCode(outcome), "unsafe_path", name);
        assert.equal(outcome.stdout, "", name);
      }
    }
  });
});

test("a planlet file symlinked outside the repository is refused", () => {
  withRepository((root, outside) => {
    const escapedTasks = join(outside, "tasks.md");
    writeFileSync(escapedTasks, "# Tasks: Escaped File\n\n- [ ] T1 Escape\n");
    const directory = writePlanlet(root, "escaped-file", {
      plan: "# Escaped File\n",
    });
    symlinkSync(escapedTasks, join(directory, "tasks.md"), "file");

    for (const command of ["show", "tasks"] as const) {
      const outcome = run(root, SLUG_COMMANDS[command]!("escaped-file"));
      assert.equal(outcome.exitCode, 5, command);
      assert.equal(errorCode(outcome), "unsafe_path", command);
      assert.equal(outcome.stdout, "", command);
    }

    // validate reports a per-planlet escape as an invalid entry, not a throw.
    const validated = run(root, SLUG_COMMANDS.validate!("escaped-file"));
    assert.equal(validated.exitCode, 3);
    assert.deepEqual(validationErrorCodes(validated), ["unsafe_path"]);
  });
});

test("symlinks that stay inside the repository remain usable", () => {
  withRepository((root) => {
    const real = writePlanlet(root, "real-plan", {
      plan: COMPLETE_PLAN.replace("# Fixture", "# Real Plan"),
      tasks: "# Tasks: Real Plan\n\n- [ ] T1 Stay inside\n",
    });
    symlinkSync(real, join(root, "plans", "linked-plan"), "dir");

    const outcome = run(root, SLUG_COMMANDS.show!("linked-plan"));
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.stderr, "");
  });
});

test("targeted reads ignore unrelated escaping planlet symlinks", () => {
  withRepository((root, outside) => {
    writePlanlet(root, "valid-plan", {
      plan: COMPLETE_PLAN.replace("# Fixture", "# Valid Plan"),
      tasks: "# Tasks: Valid Plan\n\n- [ ] T1 Read this\n",
    });
    mkdirSync(join(outside, "unrelated-plan"));
    symlinkSync(
      join(outside, "unrelated-plan"),
      join(root, "plans", "unrelated-plan"),
      "dir",
    );

    for (const command of ["show", "tasks", "validate"] as const) {
      const outcome = run(root, SLUG_COMMANDS[command]!("valid-plan"));
      assert.equal(outcome.exitCode, 0, command);
      assert.equal(outcome.stderr, "", command);
    }

    const all = run(root, (context) => handleValidate({}, context));
    assert.equal(all.exitCode, 3);
    assert.deepEqual(validationErrorCodes(all), ["unsafe_path", "undefined"]);
  });
});

test("directory enumeration failures become structured plan errors", () => {
  withRepository((root) => {
    const plans = join(root, "plans");
    chmodSync(plans, 0o000);
    try {
      const outcome = run(root, (context) => handleValidate({}, context));
      assert.equal(outcome.exitCode, 3);
      assert.equal(errorCode(outcome), "invalid_plan");
      assert.match(outcome.stderr, /Cannot read planlet directory/);
    } finally {
      chmodSync(plans, 0o700);
    }
  });
});

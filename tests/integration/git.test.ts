import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { tryStage, tryStageMove } from "../../src/core/git.js";
import {
  addWorktree,
  commitAll,
  porcelain,
  stageFile,
  withGitRoot,
} from "./git-fixtures.js";

test("tryStage no-ops without any git marker", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-git-nomarker-"));
  try {
    const warnings: string[] = [];
    const target = join(root, "a.txt");
    writeFileSync(target, "a\n");

    tryStage(root, [target], warnings);

    assert.deepEqual(warnings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tryStage stages only the requested paths in a git repository", async () => {
  await withGitRoot(async (root) => {
    const a = join(root, "a.txt");
    const b = join(root, "b.txt");
    writeFileSync(a, "a\n");
    writeFileSync(b, "b\n");
    commitAll(root, "base");
    writeFileSync(a, "a2\n");
    writeFileSync(b, "b2\n");
    writeFileSync(join(root, "other.txt"), "keep unstaged\n");

    const warnings: string[] = [];
    tryStage(root, [a], warnings);

    assert.deepEqual(warnings, []);
    const lines = porcelain(root);
    assert.ok(lines.includes("M  a.txt"));
    assert.ok(lines.includes(" M b.txt"));
    assert.ok(lines.includes("?? other.txt"));
  });
});

test("tryStage turns a git failure into a warning without throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-git-failure-"));
  try {
    writeFileSync(join(root, ".git"), "gitdir: /nonexistent\n");
    const target = join(root, "a.txt");
    writeFileSync(target, "a\n");

    const warnings: string[] = [];
    tryStage(root, [target], warnings);

    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]!.startsWith("Could not stage"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tryStage recognizes a worktree .git file marker", async () => {
  await withGitRoot(async (root) => {
    writeFileSync(join(root, "placeholder.txt"), "x\n");
    commitAll(root, "base");
    const worktreePath = join(
      tmpdir(),
      `planlet-git-worktree-${Math.random().toString(36).slice(2)}`,
    );
    addWorktree(root, worktreePath, "fixture-wt");
    try {
      const target = join(worktreePath, "wt.txt");
      writeFileSync(target, "x\n");

      const warnings: string[] = [];
      tryStage(worktreePath, [target], warnings);

      assert.deepEqual(warnings, []);
      assert.ok(porcelain(worktreePath).includes("A  wt.txt"));
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

test("tryStage finds a git marker in a parent directory for a nested root", async () => {
  await withGitRoot(async (root) => {
    const pkg = join(root, "packages", "pkg");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(root, "placeholder.txt"), "x\n");
    commitAll(root, "base");
    const target = join(pkg, "a.txt");
    writeFileSync(target, "x\n");

    const warnings: string[] = [];
    tryStage(pkg, [target], warnings);

    assert.deepEqual(warnings, []);
    assert.ok(porcelain(root).includes("A  packages/pkg/a.txt"));
  });
});

test("tryStageMove stages deletion and destination together for a tracked source", async () => {
  await withGitRoot(async (root) => {
    const source = join(root, "plans", "fixture-plan");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "plan.md"), "plan\n");
    writeFileSync(join(source, "tasks.md"), "tasks\n");
    writeFileSync(join(root, "other.txt"), "keep\n");
    commitAll(root, "base");
    writeFileSync(join(root, "other.txt"), "keep unstaged\n");
    const destination = join(
      root,
      "plans",
      "completed",
      "2027-01-02-fixture-plan",
    );
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);

    const warnings: string[] = [];
    tryStageMove(root, source, destination, warnings);

    assert.deepEqual(warnings, []);
    assert.deepEqual(porcelain(root).sort(), [
      " M other.txt",
      "R  plans/fixture-plan/plan.md -> plans/completed/2027-01-02-fixture-plan/plan.md",
      "R  plans/fixture-plan/tasks.md -> plans/completed/2027-01-02-fixture-plan/tasks.md",
    ]);
  });
});

test("tryStageMove stages deletion and destination together for a staged-but-uncommitted source", async () => {
  await withGitRoot(async (root) => {
    const source = join(root, "plans", "fixture-plan");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "plan.md"), "plan\n");
    writeFileSync(join(source, "tasks.md"), "tasks\n");
    writeFileSync(join(root, "other.txt"), "keep\n");
    commitAll(root, "base");
    const tasksPath = join(source, "tasks.md");
    writeFileSync(
      tasksPath,
      "# Staged draft\n\ncompletely different content\n",
    );
    stageFile(root, tasksPath);
    writeFileSync(join(root, "other.txt"), "keep unstaged\n");
    const destination = join(
      root,
      "plans",
      "completed",
      "2027-01-02-fixture-plan",
    );
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);

    const warnings: string[] = [];
    tryStageMove(root, source, destination, warnings);

    assert.deepEqual(warnings, []);
    assert.deepEqual(porcelain(root).sort(), [
      " M other.txt",
      "A  plans/completed/2027-01-02-fixture-plan/tasks.md",
      "D  plans/fixture-plan/tasks.md",
      "R  plans/fixture-plan/plan.md -> plans/completed/2027-01-02-fixture-plan/plan.md",
    ]);
  });
});

test("tryStageMove stages only the destination for a never-tracked source", async () => {
  await withGitRoot(async (root) => {
    writeFileSync(join(root, "placeholder.txt"), "x\n");
    commitAll(root, "base");
    const source = join(root, "plans", "fixture-plan");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "plan.md"), "plan\n");
    writeFileSync(join(source, "tasks.md"), "tasks\n");
    writeFileSync(join(root, "other.txt"), "keep unstaged\n");
    const destination = join(
      root,
      "plans",
      "completed",
      "2027-01-02-fixture-plan",
    );
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);

    const warnings: string[] = [];
    tryStageMove(root, source, destination, warnings);

    assert.deepEqual(warnings, []);
    assert.deepEqual(porcelain(root).sort(), [
      "?? other.txt",
      "A  plans/completed/2027-01-02-fixture-plan/plan.md",
      "A  plans/completed/2027-01-02-fixture-plan/tasks.md",
    ]);
  });
});

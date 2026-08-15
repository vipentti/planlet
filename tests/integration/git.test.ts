import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { listDiffPaths, tryStage } from "../../src/core/git.js";
import { PlanletError } from "../../src/errors/planlet-error.js";
import {
  addWorktree,
  commitAll,
  porcelain,
  withGitRoot,
} from "./git-fixtures.js";

test("listDiffPaths resolves base refs and preserves NUL-delimited paths", async () => {
  await withGitRoot(async (root) => {
    writeFileSync(join(root, "placeholder.txt"), "base\n");
    commitAll(root, "base");
    const changedPath = join(
      root,
      "plans",
      "space-plan",
      "file with space name.md",
    );
    mkdirSync(dirname(changedPath), { recursive: true });
    writeFileSync(changedPath, "changed\n");
    commitAll(root, "change");

    assert.deepEqual(
      listDiffPaths(root, { base: "HEAD~1", pathspec: "plans/" }),
      ["plans/space-plan/file with space name.md"],
    );
  });
});

test("listDiffPaths rejects an empty base without invoking git", () => {
  assert.throws(
    () => listDiffPaths("/path/that/does/not/exist", { base: "" }),
    (error) =>
      error instanceof PlanletError &&
      error.code === "git_error" &&
      error.details.base === "",
  );
});

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

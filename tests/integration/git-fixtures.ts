import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Creates a real git repository under a fresh temp directory and cleans up. */
export async function withGitRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "planlet-git-"));
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Staged added-file paths from `git status --porcelain`. */
export function stagedFiles(root: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("A "))
    .map((line) => line.slice(3));
}

/** All non-empty `git status --porcelain` lines. */
export function porcelain(root: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

/** Adds a new worktree at a fresh path checked out at the current HEAD. */
export function addWorktree(
  repositoryRoot: string,
  worktreePath: string,
  branch: string,
): void {
  const result = spawnSync(
    "git",
    ["worktree", "add", "-q", "-b", branch, worktreePath, "HEAD"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

/** Stages one explicit path. */
export function stageFile(root: string, path: string): void {
  const result = spawnSync("git", ["add", "--", path], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

/** Adds and commits the whole repository with a fixed test identity. */
export function commitAll(root: string, message: string): void {
  const add = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync(
    "git",
    [
      "-c",
      "user.email=planlet@test",
      "-c",
      "user.name=Planlet Test",
      "commit",
      "-qm",
      message,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(commit.status, 0, commit.stderr);
}

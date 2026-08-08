import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { tryLstat } from "./paths.js";

/**
 * True when the repository root carries a git marker. Uses lstat so the gate
 * also passes in git worktrees, where `.git` is a regular file rather than a
 * directory.
 */
export function hasGitMarker(repositoryRoot: string): boolean {
  return tryLstat(join(repositoryRoot, ".git")) !== null;
}

function runGitAdd(
  repositoryRoot: string,
  paths: readonly string[],
): string | undefined {
  const result = spawnSync("git", ["add", ...paths], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) return result.error.message;
  if (result.status !== 0) {
    return (
      result.stderr.trim() || `git add exited with status ${result.status}`
    );
  }
  return undefined;
}

/**
 * Stages one explicit path. Returns a warning message on failure, undefined on
 * success. Call only after `hasGitMarker`; the caller turns failures into
 * warnings, never command failures. Never stages with `-A` and never inspects
 * the rest of the working tree.
 */
export function stageFile(
  repositoryRoot: string,
  file: string,
): string | undefined {
  return runGitAdd(repositoryRoot, [file]);
}

/**
 * Stages several explicit paths with one `git add`. Completion passes the
 * source directory (whose pathspec covers the recursive deletion) together
 * with the destination directory so git records the move as a rename.
 */
export function stagePaths(
  repositoryRoot: string,
  paths: readonly string[],
): string | undefined {
  return runGitAdd(repositoryRoot, paths);
}

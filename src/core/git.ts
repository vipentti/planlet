import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { tryLstat } from "./paths.js";

// lstat so the gate also passes in worktrees, where `.git` is a regular file;
// any error other than a missing marker counts as no marker.
function hasGitMarker(repositoryRoot: string): boolean {
  try {
    return tryLstat(join(repositoryRoot, ".git")) !== null;
  } catch {
    return false;
  }
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

// Completion passes the source directory (its pathspec covers the recursive
// deletion) together with the destination so git records the move as a rename.
function stagePaths(
  repositoryRoot: string,
  paths: readonly string[],
): string | undefined {
  return runGitAdd(repositoryRoot, paths);
}

/**
 * Stages the given paths when the repository has a git marker, appending a
 * warning to `warnings` on failure. The single guard every planlet-writing
 * command uses: git failure is a warning, never a failed command.
 */
export function tryStage(
  repositoryRoot: string,
  paths: readonly string[],
  warnings: string[],
  label: string,
): void {
  if (!hasGitMarker(repositoryRoot)) return;
  const failure = stagePaths(repositoryRoot, paths);
  if (failure !== undefined) {
    warnings.push(`Could not stage ${label}: ${failure}`);
  }
}

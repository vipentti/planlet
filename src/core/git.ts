import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { tryLstat } from "./paths.js";

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
 * Stages the given paths when the repository has a git marker, appending a
 * warning to `warnings` on failure. Completion passes the source directory
 * (whose pathspec covers the recursive deletion) together with the destination
 * so git records the move as a rename. A marker check that throws (for example
 * an unreadable `.git` entry) also becomes a warning, never a command failure.
 */
export function tryStage(
  repositoryRoot: string,
  paths: readonly string[],
  warnings: string[],
): void {
  const label = paths.join(" ");
  let gitMarker: boolean;
  try {
    // lstat so the gate also passes in worktrees, where `.git` is a regular file.
    gitMarker = tryLstat(join(repositoryRoot, ".git")) !== null;
  } catch (error) {
    warnings.push(
      `Could not stage ${label}: cannot check git marker: ${errorMessage(error)}`,
    );
    return;
  }
  if (!gitMarker) return;
  const failure = runGitAdd(repositoryRoot, paths);
  if (failure !== undefined) {
    warnings.push(`Could not stage ${label}: ${failure}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

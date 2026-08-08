import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { tryLstat } from "./paths.js";

function runGit(
  repositoryRoot: string,
  args: readonly string[],
): string | undefined {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) return result.error.message;
  if (result.status !== 0) {
    return (
      result.stderr.trim() ||
      `git ${args[0]} exited with status ${result.status}`
    );
  }
  return undefined;
}

interface GitMarker {
  readonly found: boolean;
  readonly error?: string | undefined;
}

/**
 * True when the repository root or any ancestor directory carries a `.git`
 * marker (a directory in a regular checkout, a regular file in a worktree).
 * Explicit Planlet roots may be package subdirectories of a parent worktree.
 * An unreadable directory during the walk reports as an error instead of being
 * swallowed, so staging skips with a warning rather than silently.
 */
function findGitMarker(repositoryRoot: string): GitMarker {
  let current = resolve(repositoryRoot);
  for (;;) {
    try {
      if (tryLstat(join(current, ".git")) !== null) return { found: true };
    } catch (error) {
      return { found: false, error: errorMessage(error) };
    }
    const parent = dirname(current);
    if (parent === current) return { found: false };
    current = parent;
  }
}

function withGitMarker(
  repositoryRoot: string,
  warnings: string[],
  label: string,
  stage: (repositoryRoot: string) => void,
): void {
  const marker = findGitMarker(repositoryRoot);
  if (marker.error !== undefined) {
    warnings.push(
      `Could not stage ${label}: cannot check git marker: ${marker.error}`,
    );
    return;
  }
  if (!marker.found) return;
  stage(repositoryRoot);
}

/**
 * Stages the given paths with one explicit `git add`, appending a warning to
 * `warnings` on failure. The guard every task-mutation command uses: git
 * failure is a warning, never a failed command.
 */
export function tryStage(
  repositoryRoot: string,
  paths: readonly string[],
  warnings: string[],
): void {
  const label = paths.join(" ");
  withGitMarker(repositoryRoot, warnings, label, (repo) => {
    const failure = runGit(repo, ["add", "--", ...paths]);
    if (failure !== undefined) {
      warnings.push(`Could not stage ${label}: ${failure}`);
    }
  });
}

/**
 * Stages a planlet move with index-only operations: explicitly adds the
 * destination and removes any source entries from the index. `--ignore-unmatch`
 * keeps a never-tracked source a success rather than a warning. Appends a
 * warning to `warnings` on real git failure, never failing the command.
 */
export function tryStageMove(
  repositoryRoot: string,
  source: string,
  destination: string,
  warnings: string[],
): void {
  const label = `${source} ${destination}`;
  withGitMarker(repositoryRoot, warnings, label, (repo) => {
    const add = runGit(repo, ["add", "--", destination]);
    if (add !== undefined) {
      warnings.push(`Could not stage ${label}: ${add}`);
      return;
    }
    const remove = runGit(repo, [
      "rm",
      "--cached",
      "--ignore-unmatch",
      "-r",
      "--",
      source,
    ]);
    if (remove !== undefined) {
      warnings.push(`Could not stage ${label}: ${remove}`);
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

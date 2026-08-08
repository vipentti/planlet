import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { tryLstat } from "./paths.js";

function runGitOutput(
  repositoryRoot: string,
  args: readonly string[],
): { stdout: string; failure: string | undefined } {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    return { stdout: "", failure: result.error.message };
  }
  if (result.status !== 0) {
    return {
      stdout: "",
      failure:
        result.stderr.trim() ||
        `git ${args[0]} exited with status ${result.status}`,
    };
  }
  return { stdout: result.stdout.trim(), failure: undefined };
}

function runGit(
  repositoryRoot: string,
  args: readonly string[],
): string | undefined {
  return runGitOutput(repositoryRoot, args).failure;
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
 * `warnings` on failure. `label` names the paths in warnings independently of
 * the git pathspec (so callers can show a repository-relative name). The guard
 * every task-mutation command uses: git failure is a warning, never a failed
 * command.
 */
export function tryStage(
  repositoryRoot: string,
  paths: readonly string[],
  warnings: string[],
  label?: string | undefined,
): void {
  const displayLabel = label ?? paths.join(" ");
  withGitMarker(repositoryRoot, warnings, displayLabel, (repo) => {
    const failure = runGit(repo, ["add", "--", ...paths]);
    if (failure !== undefined) {
      warnings.push(`Could not stage ${displayLabel}: ${failure}`);
    }
  });
}

/**
 * Stages a planlet move with exactly one index mutation. Inspects the source
 * with `git ls-files` first: when the source has index entries (tracked, or
 * staged but uncommitted), a single path-scoped `git add -A -- <source>
 * <destination>` stages the source deletion and the destination together, so
 * the index can never be left half-applied. A never-tracked source only gets
 * the destination added. Appends a warning to `warnings` on real git failure,
 * never failing the command.
 */
export function tryStageMove(
  repositoryRoot: string,
  source: string,
  destination: string,
  warnings: string[],
): void {
  const label = `${source} ${destination}`;
  withGitMarker(repositoryRoot, warnings, label, (repo) => {
    const inspected = runGitOutput(repo, ["ls-files", "--", source]);
    if (inspected.failure !== undefined) {
      warnings.push(`Could not stage ${label}: ${inspected.failure}`);
      return;
    }
    const args =
      inspected.stdout === ""
        ? ["add", "--", destination]
        : ["add", "-A", "--", source, destination];
    const failure = runGit(repo, args);
    if (failure !== undefined) {
      warnings.push(`Could not stage ${label}: ${failure}`);
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

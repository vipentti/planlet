import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { tryLstat } from "./paths.js";
import { PlanletError } from "../errors/planlet-error.js";

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

function runGitRawOutput(
  repositoryRoot: string,
  args: readonly string[],
): { stdout: string; failure: string | undefined } {
  try {
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
    return { stdout: result.stdout, failure: undefined };
  } catch (error) {
    return { stdout: "", failure: errorMessage(error) };
  }
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

export interface ListDiffPathsOptions {
  readonly base: string;
  readonly pathspec?: string | undefined;
}

/**
 * Resolves a caller-supplied base ref and lists changed paths from its
 * three-dot range to HEAD. The raw NUL-delimited output is split without
 * trimming so filenames containing whitespace remain intact.
 */
export function listDiffPaths(
  repositoryRoot: string,
  options: ListDiffPathsOptions,
): readonly string[] {
  if (options.base.length === 0) {
    throw new PlanletError("git_error", "Git base ref cannot be empty", {
      details: { base: options.base },
    });
  }

  const resolved = runGitRawOutput(repositoryRoot, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${options.base}^{commit}`,
  ]);
  if (resolved.failure !== undefined) {
    throw new PlanletError("git_error", "Could not resolve Git base ref", {
      details: { base: options.base, reason: resolved.failure },
    });
  }

  const oid = resolved.stdout.trim();
  if (oid.length === 0) {
    throw new PlanletError("git_error", "Git returned an empty base commit", {
      details: { base: options.base },
    });
  }

  const pathspec = options.pathspec ?? "plans/";
  const diff = runGitRawOutput(repositoryRoot, [
    "diff",
    "--name-only",
    "--relative",
    "-z",
    `${oid}...HEAD`,
    "--",
    pathspec,
  ]);
  if (diff.failure !== undefined) {
    throw new PlanletError("git_error", "Could not list Git changes", {
      details: { base: options.base, reason: diff.failure },
    });
  }

  return diff.stdout.split("\0").filter((path) => path.length > 0);
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

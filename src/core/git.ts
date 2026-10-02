import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { tryLstat } from "./paths.js";
import { PlanletError } from "../errors/planlet-error.js";

function runGitOutput(
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

export interface ListDiffPathsOptions {
  readonly base: string;
  readonly pathspec?: string | undefined;
}

function resolveBaseOid(repositoryRoot: string, base: string): string {
  if (base.length === 0) {
    throw new PlanletError("git_error", "Git base ref cannot be empty", {
      details: { base },
    });
  }

  const resolved = runGitOutput(repositoryRoot, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]);
  if (resolved.failure !== undefined) {
    throw new PlanletError("git_error", "Could not resolve Git base ref", {
      details: { base, reason: resolved.failure },
    });
  }

  const oid = resolved.stdout.trim();
  if (oid.length === 0) {
    throw new PlanletError("git_error", "Git returned an empty base commit", {
      details: { base },
    });
  }
  return oid;
}

export function resolveMergeBase(repositoryRoot: string, base: string): string {
  const oid = resolveBaseOid(repositoryRoot, base);
  const mergeBase = runGitOutput(repositoryRoot, ["merge-base", oid, "HEAD"]);
  if (mergeBase.failure !== undefined) {
    throw new PlanletError("git_error", "Could not resolve Git merge base", {
      details: { base, reason: mergeBase.failure },
    });
  }
  const mergeOid = mergeBase.stdout.trim();
  if (mergeOid.length === 0) {
    throw new PlanletError("git_error", "Git returned an empty merge base", {
      details: { base },
    });
  }
  return mergeOid;
}

/**
 * Resolves a caller-supplied base ref and lists changed paths from its
 * three-dot range to HEAD. Rename detection is disabled so an archive move
 * produces both its active deletion and archive addition. The raw NUL-
 * delimited output is split without trimming so filenames containing
 * whitespace remain intact.
 */
export function listDiffPaths(
  repositoryRoot: string,
  options: ListDiffPathsOptions,
): readonly string[] {
  const oid = resolveBaseOid(repositoryRoot, options.base);
  const pathspec = options.pathspec ?? "plans/";
  const diff = runGitOutput(repositoryRoot, [
    "diff",
    "--name-only",
    "--no-renames",
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

export interface DiffPathEntry {
  readonly path: string;
  readonly srcSha: string;
  readonly dstSha: string;
  readonly status: string;
}

const RAW_DIFF_META =
  /^:(\d+) (\d+) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z](?:\d{3})?)$/;

/**
 * Same range and rename policy as `listDiffPaths`, plus blob SHAs so a
 * plansDir relocation can be distinguished from an in-place edit.
 */
export function listDiffEntries(
  repositoryRoot: string,
  options: ListDiffPathsOptions,
): readonly DiffPathEntry[] {
  const oid = resolveBaseOid(repositoryRoot, options.base);
  const pathspec = options.pathspec ?? "plans/";
  const diff = runGitOutput(repositoryRoot, [
    "diff",
    "--raw",
    "--abbrev=40",
    "--no-renames",
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

  const parts = diff.stdout.split("\0");
  const entries: DiffPathEntry[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const meta = parts[index]!;
    const path = parts[index + 1]!;
    if (path.length === 0) {
      continue;
    }
    const match = RAW_DIFF_META.exec(meta);
    if (match === null) {
      throw new PlanletError("git_error", "Could not parse Git raw diff", {
        details: { base: options.base, record: meta },
      });
    }
    entries.push({
      path,
      srcSha: match[3]!,
      dstSha: match[4]!,
      status: match[5]!,
    });
  }
  return entries;
}

export function readCommitFile(
  repositoryRoot: string,
  options: { readonly base: string; readonly path: string },
): string | undefined {
  const oid = resolveBaseOid(repositoryRoot, options.base);
  const gitPath = options.path.startsWith("./")
    ? options.path
    : `./${options.path}`;
  const listed = runGitOutput(repositoryRoot, [
    "ls-tree",
    "--name-only",
    "-z",
    oid,
    "--",
    gitPath,
  ]);
  if (listed.failure !== undefined) {
    throw new PlanletError("git_error", "Could not read Git tree path", {
      details: {
        base: options.base,
        path: options.path,
        reason: listed.failure,
      },
    });
  }
  const names = listed.stdout.split("\0").filter((name) => name.length > 0);
  if (names.length === 0) {
    return undefined;
  }
  const shown = runGitOutput(repositoryRoot, ["show", `${oid}:${gitPath}`]);
  if (shown.failure !== undefined) {
    throw new PlanletError("git_error", "Could not read Git blob", {
      details: {
        base: options.base,
        path: options.path,
        reason: shown.failure,
      },
    });
  }
  return shown.stdout;
}

export function readGitBlob(repositoryRoot: string, sha: string): string {
  if (!/^[0-9a-f]{40}$/.test(sha) || sha === "0".repeat(40)) {
    throw new PlanletError("git_error", "Could not read Git blob", {
      details: { sha },
    });
  }
  const shown = runGitOutput(repositoryRoot, ["cat-file", "-p", sha]);
  if (shown.failure !== undefined) {
    throw new PlanletError("git_error", "Could not read Git blob", {
      details: { sha, reason: shown.failure },
    });
  }
  return shown.stdout;
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

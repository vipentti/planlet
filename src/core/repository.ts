import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { PlanletError } from "../errors/planlet-error.js";
import { tryLstat } from "./paths.js";

export interface DiscoverRepositoryOptions {
  readonly startPath: string;
  readonly explicitRoot?: string | undefined;
  readonly allowUnmarkedStart?: boolean | undefined;
}

function canonicalDirectory(path: string): string | null {
  const stats = tryLstat(path);
  if (stats === null || !stats.isDirectory()) {
    return null;
  }

  return realpathSync(path);
}

function hasRepositoryMarker(path: string): boolean {
  return tryLstat(join(path, ".git")) !== null;
}

function hasPlansDirectory(path: string): boolean {
  return tryLstat(join(path, "plans"))?.isDirectory() ?? false;
}

export function discoverRepositoryRoot(
  options: DiscoverRepositoryOptions,
): string {
  if (options.explicitRoot !== undefined) {
    const explicitRoot = canonicalDirectory(resolve(options.explicitRoot));
    if (explicitRoot !== null) {
      return explicitRoot;
    }

    throw new PlanletError(
      "repo_not_found",
      `Repository root is not a readable directory: ${options.explicitRoot}`,
      { details: { root: options.explicitRoot } },
    );
  }

  const start = canonicalDirectory(resolve(options.startPath));
  if (start === null) {
    throw new PlanletError(
      "repo_not_found",
      `Repository start path is not a readable directory: ${options.startPath}`,
      { details: { startPath: options.startPath } },
    );
  }

  let candidate = start;
  while (true) {
    if (hasRepositoryMarker(candidate)) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }

  if (hasPlansDirectory(start) || options.allowUnmarkedStart === true) {
    return start;
  }

  throw new PlanletError(
    "repo_not_found",
    `No repository root found from: ${options.startPath}`,
    { details: { startPath: options.startPath } },
  );
}

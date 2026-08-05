import { lstatSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ErrorCode } from "../errors/codes.js";
import { PlanletError, type ErrorDetails } from "../errors/planlet-error.js";

export function errnoIs(error: unknown, ...codes: readonly string[]): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}

export function byName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface AtomicPublishCleanupFailure {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: ErrorDetails;
  readonly aggregateMessage?: string;
  /** Whether a cleanup failure masks the primary publish failure. */
  readonly fatal: boolean;
}

export interface AtomicPublishOptions {
  readonly temporaryPath: string;
  readonly targetPath: string;
  readonly createTemporary: () => void;
  readonly prepare?: () => void;
  readonly rename: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  /** Maps the primary failure to the call site's own error. */
  readonly onFailure: (error: unknown) => PlanletError;
  readonly cleanupFailure: AtomicPublishCleanupFailure;
}

/**
 * Publishes `targetPath` atomically: create a temporary sibling, prepare it,
 * then rename over the target. On failure the temporary is removed; a
 * failing cleanup throws the configured double-fault error with both causes
 * when fatal, otherwise the primary error keeps `cleanupFailed: true`.
 */
export function atomicPublish(options: AtomicPublishOptions): void {
  let temporaryCreated = false;
  let published = false;
  let primary: PlanletError | undefined;

  try {
    options.createTemporary();
    temporaryCreated = true;
    options.prepare?.();
    options.rename(options.temporaryPath, options.targetPath);
    published = true;
  } catch (error) {
    primary = options.onFailure(error);
  }

  if (temporaryCreated && !published) {
    try {
      options.remove(options.temporaryPath);
    } catch (cleanupFailure) {
      if (options.cleanupFailure.fatal) {
        throw new PlanletError(
          options.cleanupFailure.code,
          options.cleanupFailure.message,
          {
            details: options.cleanupFailure.details,
            cause: new AggregateError(
              [primary ?? cleanupFailure, cleanupFailure],
              options.cleanupFailure.aggregateMessage,
            ),
          },
        );
      }
      if (primary instanceof PlanletError) {
        throw new PlanletError(primary.code, primary.message, {
          details: { ...primary.details, cleanupFailed: true },
          cause: primary.cause,
          ...(primary.next === undefined ? {} : { next: primary.next }),
        });
      }
      throw cleanupFailure;
    }
  }

  if (primary !== undefined) {
    throw primary;
  }
}

/** `lstatSync` that reports a missing path as `null` and rethrows anything else. */
export function tryLstat(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    // ENOTDIR means a parent component is a file, so this path does not exist
    // either; callers classify the offending parent themselves.
    if (errnoIs(error, "ENOENT", "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}

export function isPathWithinRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

/**
 * Resolves a repository-relative path and follows every existing component so
 * an escaping symlink cannot hide beneath a lexically safe path.
 */
export function resolveSafePath(
  repositoryRoot: string,
  ...relativeSegments: readonly string[]
): string {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(repositoryRoot);
  } catch (error) {
    throw new PlanletError(
      "unsafe_path",
      `Cannot resolve repository root: ${repositoryRoot}`,
      { details: { root: repositoryRoot }, cause: error },
    );
  }

  if (relativeSegments.some((segment) => isAbsolute(segment))) {
    throw new PlanletError("unsafe_path", "Absolute path segments are unsafe", {
      details: { root: canonicalRoot, segments: relativeSegments },
    });
  }

  const lexicalTarget = resolve(canonicalRoot, ...relativeSegments);
  if (!isPathWithinRoot(canonicalRoot, lexicalTarget)) {
    throw new PlanletError(
      "unsafe_path",
      `Resolved path escapes repository root: ${lexicalTarget}`,
      { details: { root: canonicalRoot, target: lexicalTarget } },
    );
  }

  const relativeTarget = relative(canonicalRoot, lexicalTarget);
  if (relativeTarget === "") {
    return canonicalRoot;
  }

  let physicalTarget = canonicalRoot;
  const components = relativeTarget.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) {
      continue;
    }

    const nextPath = resolve(physicalTarget, component);
    try {
      lstatSync(nextPath);
    } catch (error) {
      if (!errnoIs(error, "ENOENT")) {
        throw new PlanletError(
          "unsafe_path",
          `Cannot safely inspect path: ${nextPath}`,
          { details: { root: canonicalRoot, target: nextPath }, cause: error },
        );
      }

      const remaining = components.slice(index);
      physicalTarget = resolve(physicalTarget, ...remaining);
      break;
    }

    try {
      physicalTarget = realpathSync(nextPath);
    } catch (error) {
      throw new PlanletError(
        "unsafe_path",
        `Cannot resolve existing path component: ${nextPath}`,
        { details: { root: canonicalRoot, target: nextPath }, cause: error },
      );
    }

    if (!isPathWithinRoot(canonicalRoot, physicalTarget)) {
      throw new PlanletError(
        "unsafe_path",
        `Path traverses a symlink outside the repository: ${nextPath}`,
        { details: { root: canonicalRoot, target: nextPath } },
      );
    }
  }

  if (!isPathWithinRoot(canonicalRoot, physicalTarget)) {
    throw new PlanletError(
      "unsafe_path",
      `Resolved path escapes repository root: ${physicalTarget}`,
      { details: { root: canonicalRoot, target: physicalTarget } },
    );
  }

  return physicalTarget;
}

import { lstatSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { PlanletError } from "../errors/planlet-error.js";

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** `lstatSync` that reports a missing path as `null` and rethrows anything else. */
export function tryLstat(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    // ENOTDIR means a parent component is a file, so this path does not exist
    // either; callers classify the offending parent themselves.
    if (
      isMissingPathError(error) ||
      (error instanceof Error && "code" in error && error.code === "ENOTDIR")
    ) {
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
      if (!isMissingPathError(error)) {
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

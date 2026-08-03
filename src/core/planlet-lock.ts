import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { PlanletError } from "../errors/planlet-error.js";
import { resolveSafePath, tryLstat } from "./paths.js";

export const PLANLET_LOCK_DIR = ".planlet-locks";
export const PLANLET_LOCK_HOLDER = "holder.json";
/** Reserved lock name for repository-wide harness install serialization. */
export const HARNESS_INSTALL_LOCK_NAME = "__harness__";

export interface OwnedLockHolder {
  readonly pid: number;
  readonly token: string;
}

export interface OwnedLockHandle {
  readonly path: string;
  readonly token: string;
}

export interface PlanletLockDependencies {
  readonly mkdir: (path: string) => void;
  readonly rename: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly pid: number;
  readonly createToken: () => string;
}

export interface OwnedLockRunResult<T> {
  readonly value: T;
  readonly releaseWarning?: string;
}

/**
 * Conservative process probe for stale-lock reclaim.
 * - success / EPERM / EACCES / unknown → alive (do not reclaim)
 * - ESRCH / ENOENT / EINVAL → dead
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) {
      return true;
    }
    const code = error.code;
    if (code === "EPERM" || code === "EACCES") {
      return true;
    }
    if (code === "ESRCH" || code === "ENOENT" || code === "EINVAL") {
      return false;
    }
    return true;
  }
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export const DEFAULT_PLANLET_LOCK_DEPENDENCIES: PlanletLockDependencies = {
  mkdir: (path) => mkdirSync(path),
  rename: (source, destination) => renameSync(source, destination),
  remove: removeTree,
  isProcessAlive,
  pid: process.pid,
  createToken: () => randomUUID(),
};

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function assertNotSymlink(path: string, label: string): void {
  const status = tryLstat(path);
  if (status?.isSymbolicLink()) {
    throw new PlanletError(
      "unsafe_path",
      `Lock path must not be a symbolic link: ${label}`,
      { details: { label, path } },
    );
  }
}

export function readOwnedLockHolder(path: string): OwnedLockHolder | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("pid" in parsed) ||
      !("token" in parsed) ||
      typeof parsed.pid !== "number" ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.token !== "string" ||
      parsed.token.length === 0
    ) {
      return null;
    }
    return { pid: parsed.pid, token: parsed.token };
  } catch {
    return null;
  }
}

function writeHolder(path: string, holder: OwnedLockHolder): void {
  writeFileSync(path, `${JSON.stringify(holder)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function tryReclaimDeadLock(
  lockPath: string,
  label: string,
  dependencies: PlanletLockDependencies,
): boolean {
  assertNotSymlink(lockPath, label);
  const holder = readOwnedLockHolder(join(lockPath, PLANLET_LOCK_HOLDER));
  if (holder === null || dependencies.isProcessAlive(holder.pid)) {
    return false;
  }

  const quarantinePath = `${lockPath}.quarantine-${dependencies.createToken()}`;
  try {
    dependencies.rename(lockPath, quarantinePath);
  } catch {
    return false;
  }
  try {
    dependencies.remove(quarantinePath);
  } catch {
    // Leave orphan quarantine; caller may retry mkdir on the lock path.
  }
  return true;
}

function lockRoot(repositoryRoot: string): string {
  return resolveSafePath(repositoryRoot, "plans", PLANLET_LOCK_DIR);
}

/**
 * Acquires an exclusive ownership-token lock. Contending live holders fail with
 * write_conflict. Dead holders are reclaimed via atomic quarantine rename.
 */
export function acquireOwnedLock(
  rootDir: string,
  lockName: string,
  label: string,
  dependencies: Partial<PlanletLockDependencies> = {},
  nextHint?: string,
): OwnedLockHandle {
  const resolved = { ...DEFAULT_PLANLET_LOCK_DEPENDENCIES, ...dependencies };
  try {
    mkdirSync(rootDir, { recursive: true });
  } catch (createError) {
    throw new PlanletError(
      "write_conflict",
      `Could not create lock root: ${label}`,
      { details: { label, rootDir }, cause: createError },
    );
  }
  assertNotSymlink(rootDir, label);

  const lockPath = join(rootDir, lockName);
  assertNotSymlink(lockPath, label);

  const attempt = (): OwnedLockHandle => {
    resolved.mkdir(lockPath);
    const token = resolved.createToken();
    const holder: OwnedLockHolder = { pid: resolved.pid, token };
    try {
      writeHolder(join(lockPath, PLANLET_LOCK_HOLDER), holder);
    } catch (error) {
      resolved.remove(lockPath);
      throw error;
    }
    return { path: lockPath, token };
  };

  const contention = (cause?: unknown): never => {
    throw new PlanletError(
      "write_conflict",
      `Resource is locked by another process: ${label}`,
      {
        details: { label, lockPath },
        ...(cause === undefined ? {} : { cause }),
        ...(nextHint === undefined ? {} : { next: nextHint }),
      },
    );
  };

  try {
    return attempt();
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw new PlanletError(
        "write_conflict",
        `Could not acquire lock: ${label}`,
        { details: { label, lockPath }, cause: error },
      );
    }
    if (!tryReclaimDeadLock(lockPath, label, resolved)) {
      return contention();
    }
    try {
      return attempt();
    } catch (retryError) {
      return contention(retryError);
    }
  }
}

/**
 * Releases only when the caller's ownership token still matches. Mismatched
 * holders are left untouched. Throws from remove are not swallowed here.
 */
export function releaseOwnedLock(
  handle: OwnedLockHandle,
  dependencies: Partial<Pick<PlanletLockDependencies, "remove">> = {},
): void {
  const remove =
    dependencies.remove ?? DEFAULT_PLANLET_LOCK_DEPENDENCIES.remove;
  const holder = readOwnedLockHolder(join(handle.path, PLANLET_LOCK_HOLDER));
  if (holder === null || holder.token !== handle.token) {
    return;
  }
  remove(handle.path);
}

function withOwnedLock<T>(
  rootDir: string,
  lockName: string,
  label: string,
  operation: () => T,
  dependencies: Partial<PlanletLockDependencies> = {},
  nextHint?: string,
): OwnedLockRunResult<T> {
  const resolved = { ...DEFAULT_PLANLET_LOCK_DEPENDENCIES, ...dependencies };
  const handle = acquireOwnedLock(rootDir, lockName, label, resolved, nextHint);
  let value!: T;
  let operationError: unknown;
  try {
    value = operation();
  } catch (error) {
    operationError = error;
  }

  let releaseWarning: string | undefined;
  try {
    releaseOwnedLock(handle, resolved);
  } catch {
    if (operationError === undefined) {
      releaseWarning = `Lock release failed at ${handle.path}; operation succeeded but the lock may remain. Remove ${handle.path} only if no process still holds it, then retry`;
    }
  }

  if (operationError !== undefined) {
    throw operationError;
  }
  return releaseWarning === undefined ? { value } : { value, releaseWarning };
}

export function withPlanletLock<T>(
  repositoryRoot: string,
  slug: string,
  operation: () => T,
  dependencies: Partial<PlanletLockDependencies> = {},
): OwnedLockRunResult<T> {
  return withOwnedLock(
    lockRoot(repositoryRoot),
    slug,
    slug,
    operation,
    dependencies,
    `Retry after the other planlet operation finishes, or remove ${PLANLET_LOCK_DIR}/${slug} only if that process is confirmed dead`,
  );
}

export function withHarnessInstallLock<T>(
  repositoryRoot: string,
  operation: () => T,
  dependencies: Partial<PlanletLockDependencies> = {},
): OwnedLockRunResult<T> {
  return withOwnedLock(
    lockRoot(repositoryRoot),
    HARNESS_INSTALL_LOCK_NAME,
    "harness-install",
    operation,
    dependencies,
    `Retry after the other harness install finishes, or remove ${PLANLET_LOCK_DIR}/${HARNESS_INSTALL_LOCK_NAME} only if that process is confirmed dead`,
  );
}

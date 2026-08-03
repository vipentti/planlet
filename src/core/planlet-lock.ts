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

export interface PlanletLockHolder {
  readonly pid: number;
  readonly createdAt: string;
  readonly token: string;
}

export interface PlanletLockHandle {
  readonly path: string;
  readonly token: string;
}

/**
 * Testable filesystem and process seams. Defaults are production behavior;
 * tests inject mkdir/rename/isProcessAlive (and optionally pid/now/createToken).
 */
export interface PlanletLockDependencies {
  readonly mkdir: (path: string) => void;
  readonly rename: (source: string, destination: string) => void;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly pid: number;
  readonly now: () => Date;
  readonly createToken: () => string;
}

const DEFAULT_DEPENDENCIES: PlanletLockDependencies = {
  mkdir: (path) => mkdirSync(path),
  rename: (source, destination) => renameSync(source, destination),
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM/EACCES mean the process exists but we cannot signal it.
      // ESRCH/ENOENT/EINVAL (and other codes) mean the PID is not alive —
      // Windows reports dead PIDs as ENOENT or EINVAL rather than ESRCH.
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        return true;
      }
      return false;
    }
  },
  pid: process.pid,
  now: () => new Date(),
  createToken: () => randomUUID(),
};

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function lockRoot(repositoryRoot: string): string {
  return resolveSafePath(repositoryRoot, "plans", PLANLET_LOCK_DIR);
}

export function planletLockPath(repositoryRoot: string, slug: string): string {
  return resolveSafePath(repositoryRoot, "plans", PLANLET_LOCK_DIR, slug);
}

function assertNotSymlink(path: string, slug: string): void {
  const status = tryLstat(path);
  if (status?.isSymbolicLink()) {
    throw new PlanletError(
      "unsafe_path",
      `Planlet lock path must not be a symbolic link: ${slug}`,
      { details: { slug, path } },
    );
  }
}

function readHolder(path: string): PlanletLockHolder | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("pid" in parsed) ||
      !("createdAt" in parsed) ||
      !("token" in parsed) ||
      typeof parsed.pid !== "number" ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.token !== "string" ||
      parsed.token.length === 0
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      createdAt: parsed.createdAt,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

function writeHolder(path: string, holder: PlanletLockHolder): void {
  writeFileSync(path, `${JSON.stringify(holder)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/**
 * Atomically quarantine a dead-holder lock. Only the process whose rename
 * succeeds may delete the quarantine directory. Returns true when this caller
 * won the reclaim race.
 */
function tryReclaimDeadLock(
  lockPath: string,
  slug: string,
  dependencies: PlanletLockDependencies,
): boolean {
  assertNotSymlink(lockPath, slug);
  const holder = readHolder(join(lockPath, PLANLET_LOCK_HOLDER));
  // Unreadable or corrupt holders are not stolen.
  if (holder === null || dependencies.isProcessAlive(holder.pid)) {
    return false;
  }

  const quarantinePath = `${lockPath}.quarantine-${dependencies.createToken()}`;
  try {
    dependencies.rename(lockPath, quarantinePath);
  } catch {
    // Another process already reclaimed or the lock disappeared.
    return false;
  }
  removeTree(quarantinePath);
  return true;
}

function contentionError(
  slug: string,
  lockPath: string,
  cause?: unknown,
): never {
  throw new PlanletError(
    "write_conflict",
    `Planlet is locked by another process: ${slug}`,
    {
      details: { slug, lockPath },
      ...(cause === undefined ? {} : { cause }),
      next: `Retry after the other planlet operation finishes, or remove ${PLANLET_LOCK_DIR}/${slug} only if that process is confirmed dead`,
    },
  );
}

/**
 * Acquires an exclusive per-planlet lock under plans/.planlet-locks/<slug>.
 * Contending live holders fail with write_conflict. Dead-holder directories are
 * reclaimed via atomic rename into a quarantine path; live holders are never
 * stolen. The returned handle's token is required for ownership-safe release.
 */
export function acquirePlanletLock(
  repositoryRoot: string,
  slug: string,
  dependencies: Partial<PlanletLockDependencies> = {},
): PlanletLockHandle {
  const resolved = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const root = lockRoot(repositoryRoot);
  mkdirSync(root, { recursive: true });
  assertNotSymlink(root, slug);

  const lockPath = planletLockPath(repositoryRoot, slug);
  assertNotSymlink(lockPath, slug);

  const attempt = (): PlanletLockHandle => {
    resolved.mkdir(lockPath);
    const token = resolved.createToken();
    const holder: PlanletLockHolder = {
      pid: resolved.pid,
      createdAt: resolved.now().toISOString(),
      token,
    };
    try {
      writeHolder(join(lockPath, PLANLET_LOCK_HOLDER), holder);
    } catch (error) {
      removeTree(lockPath);
      throw error;
    }
    return { path: lockPath, token };
  };

  try {
    return attempt();
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw new PlanletError(
        "write_conflict",
        `Could not acquire planlet lock: ${slug}`,
        { details: { slug, lockPath }, cause: error },
      );
    }
    if (!tryReclaimDeadLock(lockPath, slug, resolved)) {
      contentionError(slug, lockPath);
    }
    try {
      return attempt();
    } catch (retryError) {
      contentionError(slug, lockPath, retryError);
    }
  }
}

/**
 * Releases a lock only when the caller's ownership token still matches the
 * holder file. Mismatched or missing holders are left untouched so a stale
 * finally-block cannot delete a replacement owner's lock.
 */
export function releasePlanletLock(handle: PlanletLockHandle): void {
  const holder = readHolder(join(handle.path, PLANLET_LOCK_HOLDER));
  if (holder === null || holder.token !== handle.token) {
    return;
  }
  removeTree(handle.path);
}

export function withPlanletLock<T>(
  repositoryRoot: string,
  slug: string,
  operation: () => T,
  dependencies: Partial<PlanletLockDependencies> = {},
): T {
  const handle = acquirePlanletLock(repositoryRoot, slug, dependencies);
  try {
    return operation();
  } finally {
    releasePlanletLock(handle);
  }
}

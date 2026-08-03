import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PlanletError } from "../errors/planlet-error.js";
import { resolveSafePath, tryLstat } from "./paths.js";

export const PLANLET_LOCK_DIR = ".planlet-locks";
export const PLANLET_LOCK_HOLDER = "holder.json";

export interface PlanletLockHolder {
  readonly pid: number;
  readonly createdAt: string;
}

export interface PlanletLockDependencies {
  readonly mkdir: (path: string) => void;
  readonly writeHolder: (path: string, holder: PlanletLockHolder) => void;
  readonly readHolder: (path: string) => PlanletLockHolder | null;
  readonly removeLock: (path: string) => void;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly pid: number;
  readonly now: () => Date;
}

const DEFAULT_DEPENDENCIES: PlanletLockDependencies = {
  mkdir: (path) => mkdirSync(path),
  writeHolder: (path, holder) =>
    writeFileSync(path, `${JSON.stringify(holder)}\n`, {
      encoding: "utf8",
      flag: "wx",
    }),
  readHolder: (path) => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("pid" in parsed) ||
        !("createdAt" in parsed) ||
        typeof parsed.pid !== "number" ||
        !Number.isInteger(parsed.pid) ||
        parsed.pid <= 0 ||
        typeof parsed.createdAt !== "string"
      ) {
        return null;
      }
      return { pid: parsed.pid, createdAt: parsed.createdAt };
    } catch {
      return null;
    }
  },
  removeLock: (path) => rmSync(path, { recursive: true, force: true }),
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      );
    }
  },
  pid: process.pid,
  now: () => new Date(),
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

function tryReclaimDeadLock(
  lockPath: string,
  slug: string,
  dependencies: PlanletLockDependencies,
): boolean {
  assertNotSymlink(lockPath, slug);
  const holderPath = join(lockPath, PLANLET_LOCK_HOLDER);
  const holder = dependencies.readHolder(holderPath);
  // Unreadable or corrupt holders are not stolen: an active writer may still
  // own the directory. Only reclaim when the recorded PID is known dead.
  if (holder === null || dependencies.isProcessAlive(holder.pid)) {
    return false;
  }
  dependencies.removeLock(lockPath);
  return true;
}

/**
 * Acquires an exclusive per-planlet lock under plans/.planlet-locks/<slug>.
 * Contending live holders fail with write_conflict. Dead-holder directories are
 * reclaimed once; live holders are never stolen.
 */
export function acquirePlanletLock(
  repositoryRoot: string,
  slug: string,
  dependencies: Partial<PlanletLockDependencies> = {},
): string {
  const resolved = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const root = lockRoot(repositoryRoot);
  mkdirSync(root, { recursive: true });
  assertNotSymlink(root, slug);

  const lockPath = planletLockPath(repositoryRoot, slug);
  assertNotSymlink(lockPath, slug);

  const attempt = (): void => {
    resolved.mkdir(lockPath);
    const holder: PlanletLockHolder = {
      pid: resolved.pid,
      createdAt: resolved.now().toISOString(),
    };
    try {
      resolved.writeHolder(join(lockPath, PLANLET_LOCK_HOLDER), holder);
    } catch (error) {
      resolved.removeLock(lockPath);
      throw error;
    }
  };

  try {
    attempt();
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw new PlanletError(
        "write_conflict",
        `Could not acquire planlet lock: ${slug}`,
        { details: { slug, lockPath }, cause: error },
      );
    }
    if (!tryReclaimDeadLock(lockPath, slug, resolved)) {
      throw new PlanletError(
        "write_conflict",
        `Planlet is locked by another process: ${slug}`,
        {
          details: { slug, lockPath },
          next: `Retry after the other planlet operation finishes, or remove ${PLANLET_LOCK_DIR}/${slug} only if that process is confirmed dead`,
        },
      );
    }
    try {
      attempt();
    } catch (retryError) {
      throw new PlanletError(
        "write_conflict",
        `Planlet is locked by another process: ${slug}`,
        {
          details: { slug, lockPath },
          cause: retryError,
          next: `Retry after the other planlet operation finishes, or remove ${PLANLET_LOCK_DIR}/${slug} only if that process is confirmed dead`,
        },
      );
    }
  }

  return lockPath;
}

export function releasePlanletLock(
  lockPath: string,
  dependencies: Partial<PlanletLockDependencies> = {},
): void {
  const resolved = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  resolved.removeLock(lockPath);
}

export function withPlanletLock<T>(
  repositoryRoot: string,
  slug: string,
  operation: () => T,
  dependencies: Partial<PlanletLockDependencies> = {},
): T {
  const lockPath = acquirePlanletLock(repositoryRoot, slug, dependencies);
  try {
    return operation();
  } finally {
    releasePlanletLock(lockPath, dependencies);
  }
}

/** Test helper: create a lock directory that looks held by an arbitrary PID. */
export function plantPlanletLock(
  repositoryRoot: string,
  slug: string,
  holder: PlanletLockHolder,
): string {
  const root = lockRoot(repositoryRoot);
  mkdirSync(root, { recursive: true });
  const lockPath = planletLockPath(repositoryRoot, slug);
  mkdirSync(lockPath);
  writeFileSync(
    join(lockPath, PLANLET_LOCK_HOLDER),
    `${JSON.stringify(holder)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return lockPath;
}

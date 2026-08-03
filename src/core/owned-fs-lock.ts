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
import { tryLstat } from "./paths.js";

export const OWNED_LOCK_HOLDER = "holder.json";

export type ProcessProbeResult = "alive" | "dead";

export interface OwnedLockHolder {
  readonly pid: number;
  readonly token: string;
}

export interface OwnedLockHandle {
  readonly path: string;
  readonly token: string;
}

export interface OwnedLockDependencies {
  readonly mkdir: (path: string) => void;
  readonly rename: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  readonly probeProcess: (pid: number) => ProcessProbeResult;
  readonly pid: number;
  readonly createToken: () => string;
}

/**
 * Conservative process probe for stale-lock reclaim.
 * - success → alive
 * - EPERM/EACCES → alive (process exists; we cannot signal it)
 * - ESRCH (POSIX) / ENOENT / EINVAL (Windows dead PID) → dead
 * - any other error → alive (indeterminate; do not reclaim)
 */
export function defaultProbeProcess(pid: number): ProcessProbeResult {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) {
      return "alive";
    }
    const code = error.code;
    if (code === "EPERM" || code === "EACCES") {
      return "alive";
    }
    if (code === "ESRCH" || code === "ENOENT" || code === "EINVAL") {
      return "dead";
    }
    return "alive";
  }
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export const DEFAULT_OWNED_LOCK_DEPENDENCIES: OwnedLockDependencies = {
  mkdir: (path) => mkdirSync(path),
  rename: (source, destination) => renameSync(source, destination),
  remove: removeTree,
  probeProcess: defaultProbeProcess,
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
  dependencies: OwnedLockDependencies,
): boolean {
  assertNotSymlink(lockPath, label);
  const holder = readOwnedLockHolder(join(lockPath, OWNED_LOCK_HOLDER));
  // Corrupt/unreadable holders and non-dead probes are never reclaimed.
  if (holder === null || dependencies.probeProcess(holder.pid) !== "dead") {
    return false;
  }

  const quarantinePath = `${lockPath}.quarantine-${dependencies.createToken()}`;
  try {
    dependencies.rename(lockPath, quarantinePath);
  } catch {
    return false;
  }
  // Rename already won; quarantine cleanup is best-effort.
  try {
    dependencies.remove(quarantinePath);
  } catch {
    // Leave orphan quarantine; caller may retry mkdir on the lock path.
  }
  return true;
}

/**
 * Acquires an exclusive ownership-token lock at `lockPath` beside `rootDir`.
 * `rootDir` is created if missing. Contending live holders fail with
 * write_conflict. Dead holders are reclaimed via atomic quarantine rename.
 */
export function acquireOwnedLock(
  rootDir: string,
  lockName: string,
  label: string,
  dependencies: Partial<OwnedLockDependencies> = {},
  nextHint?: string,
): OwnedLockHandle {
  const resolved = { ...DEFAULT_OWNED_LOCK_DEPENDENCIES, ...dependencies };
  try {
    resolved.mkdir(rootDir);
  } catch (error) {
    if (!isAlreadyExists(error)) {
      // recursive creation for the pool root
      try {
        mkdirSync(rootDir, { recursive: true });
      } catch (createError) {
        throw new PlanletError(
          "write_conflict",
          `Could not create lock root: ${label}`,
          { details: { label, rootDir }, cause: createError },
        );
      }
    }
  }
  assertNotSymlink(rootDir, label);

  const lockPath = join(rootDir, lockName);
  assertNotSymlink(lockPath, label);

  const attempt = (): OwnedLockHandle => {
    resolved.mkdir(lockPath);
    const token = resolved.createToken();
    const holder: OwnedLockHolder = { pid: resolved.pid, token };
    try {
      writeHolder(join(lockPath, OWNED_LOCK_HOLDER), holder);
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
 * holders are left untouched. Throws from remove are not swallowed here —
 * callers that need best-effort release should catch.
 */
export function releaseOwnedLock(
  handle: OwnedLockHandle,
  dependencies: Partial<Pick<OwnedLockDependencies, "remove">> = {},
): void {
  const remove = dependencies.remove ?? DEFAULT_OWNED_LOCK_DEPENDENCIES.remove;
  const holder = readOwnedLockHolder(join(handle.path, OWNED_LOCK_HOLDER));
  if (holder === null || holder.token !== handle.token) {
    return;
  }
  remove(handle.path);
}

export function withOwnedLock<T>(
  rootDir: string,
  lockName: string,
  label: string,
  operation: () => T,
  dependencies: Partial<OwnedLockDependencies> = {},
  nextHint?: string,
): T {
  const resolved = { ...DEFAULT_OWNED_LOCK_DEPENDENCIES, ...dependencies };
  const handle = acquireOwnedLock(rootDir, lockName, label, resolved, nextHint);
  try {
    return operation();
  } finally {
    try {
      releaseOwnedLock(handle, resolved);
    } catch {
      // Best-effort cleanup must not suppress the operation's error.
    }
  }
}

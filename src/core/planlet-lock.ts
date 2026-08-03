import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isPlanletError, PlanletError } from "../errors/planlet-error.js";
import { tryLstat } from "./paths.js";

/** Reserved lock name for repository-wide harness install serialization. */
export const HARNESS_INSTALL_LOCK_NAME = "__harness__";

/**
 * The token is not PID-reuse insurance; a dead process never calls release.
 * It guards the recovery this module's own error text invites: a user who
 * removes a lock that turned out to be live lets a second holder acquire, and
 * the first holder's later release would delete that holder's lock mid-write.
 * A token mismatch makes the stale release a no-op instead. Do not drop it.
 */
export interface OwnedLockHolder {
  readonly pid: number;
  readonly token: string;
}

export interface OwnedLockHandle {
  readonly path: string;
  readonly token: string;
}

export interface PlanletLockDependencies {
  readonly write: (path: string, contents: string) => void;
  readonly remove: (path: string) => void;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly pid: number;
}

export interface OwnedLockRunResult<T> {
  readonly value: T;
  readonly releaseWarning?: string;
}

/**
 * Conservative process probe for stale-lock reclaim: only a definite "no such
 * process" reclaims a lock. Everything else, including EPERM from another
 * user's live process, counts as alive. This is one comparison, not a table of
 * handled codes: rethrowing the non-ESRCH cases would crash the CLI on the
 * EPERM a shared /tmp produces whenever another user holds the lock.
 */
export function isProcessAlive(pid: number): boolean {
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
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export const DEFAULT_PLANLET_LOCK_DEPENDENCIES: PlanletLockDependencies = {
  write: (path, contents) =>
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx" }),
  remove: removeTree,
  isProcessAlive,
  pid: process.pid,
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

/**
 * Unreadable or malformed holder metadata returns null, which callers treat as
 * "not reclaimable" — contention the user resolves by hand. The positive-integer
 * check is not defensive noise: process.kill addresses a process group for pid 0
 * and every permitted process for pid -1, so a hand-edited lock file must never
 * reach the probe.
 */
export function readOwnedLockHolder(path: string): OwnedLockHolder | null {
  try {
    const { pid, token } = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<OwnedLockHolder>;
    return Number.isInteger(pid) && pid! > 0 && typeof token === "string"
      ? { pid: pid!, token }
      : null;
  } catch {
    return null;
  }
}

function tryReclaimDeadLock(
  lockPath: string,
  label: string,
  dependencies: PlanletLockDependencies,
): boolean {
  assertNotSymlink(lockPath, label);
  const holder = readOwnedLockHolder(lockPath);
  if (holder === null || dependencies.isProcessAlive(holder.pid)) {
    return false;
  }

  try {
    dependencies.remove(lockPath);
  } catch {
    return false;
  }
  return true;
}

/**
 * Locks live in the OS temp directory, not in the repository, so a transient
 * holder file never shows up in `git status` or an editor tree. The directory
 * name is keyed by owner and canonical repository root, so separate checkouts
 * never share a namespace and a shared `/tmp` cannot produce cross-user
 * permission failures.
 *
 * ponytail: scope is per machine and per user. One checkout mounted into two
 * containers gets two lock namespaces; move the root back under the repository
 * if that ever needs mutual exclusion.
 */
export function planletLockRoot(repositoryRoot: string): string {
  const owner = process.getuid?.() ?? "";
  // Two paths that symlink to one checkout must share a namespace, or the lock
  // stops excluding anything. CLI roots are already lexically resolved, so this
  // only collapses symlinks; fall back to the input if the root is unreadable.
  let canonical = repositoryRoot;
  try {
    canonical = realpathSync(repositoryRoot);
  } catch {
    // Keep the lexical path: acquisition reports the real failure.
  }
  // Hashed, not a sanitized copy of the path: a readable encoding of a deep
  // checkout exceeds the 255-byte filename limit and publishes the user's
  // directory layout into a world-readable /tmp.
  const key = createHash("sha256")
    .update(`${owner}\0${canonical}`)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), `planlet-locks-${key}`);
}

/**
 * Acquires an exclusive ownership-token lock. The lock is a holder file created
 * with an atomic exclusive write, so ownership is readable the moment the lock
 * exists. Contending live holders fail with write_conflict; a dead holder's lock
 * is removed and re-acquired.
 *
 * The ownership token is what makes reclaim safe: a holder whose lock was
 * reclaimed as stale finds a token mismatch on release and leaves the new
 * holder's lock alone.
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
    const token = randomUUID();
    const holder: OwnedLockHolder = { pid: resolved.pid, token };
    resolved.write(lockPath, `${JSON.stringify(holder)}\n`);
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
  const holder = readOwnedLockHolder(handle.path);
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
  } catch (releaseError) {
    if (operationError !== undefined) {
      // Keep the operation's structured code and message: the release failure
      // is extra recovery information, not a different error. A bare
      // AggregateError here would reach the CLI boundary as internal_error and
      // the lock path would never be printed. Warning on stderr instead is not
      // an option either: rendering belongs to the command handlers, and this
      // module writes no output.
      const failed = isPlanletError(operationError)
        ? operationError
        : undefined;
      throw new PlanletError(
        failed?.code ?? "write_conflict",
        failed?.message ??
          `Operation failed and lock release also failed: ${handle.path}`,
        {
          details: {
            ...(failed?.details ?? {}),
            lockPath: handle.path,
            lockReleaseFailed: true,
          },
          next: `Remove ${handle.path} only if no process still holds it, then retry`,
          cause: new AggregateError([operationError, releaseError]),
        },
      );
    }
    releaseWarning = `Lock release failed at ${handle.path}; operation succeeded but the lock may remain. Remove ${handle.path} only if no process still holds it, then retry`;
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
  const root = planletLockRoot(repositoryRoot);
  return withOwnedLock(
    root,
    slug,
    slug,
    operation,
    dependencies,
    `Retry after the other planlet operation finishes, or remove ${join(root, slug)} only if that process is confirmed dead`,
  );
}

export function withHarnessInstallLock<T>(
  repositoryRoot: string,
  operation: () => T,
  dependencies: Partial<PlanletLockDependencies> = {},
): OwnedLockRunResult<T> {
  const root = planletLockRoot(repositoryRoot);
  return withOwnedLock(
    root,
    HARNESS_INSTALL_LOCK_NAME,
    "harness-install",
    operation,
    dependencies,
    `Retry after the other harness install finishes, or remove ${join(root, HARNESS_INSTALL_LOCK_NAME)} only if that process is confirmed dead`,
  );
}

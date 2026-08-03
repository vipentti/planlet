import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
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
 * Release renames the path aside and deletes only when the quarantined token
 * still matches, so a read-then-unlink race cannot drop a successor's lock.
 * Do not drop the token.
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
  readonly rename: (from: string, to: string) => void;
  readonly remove: (path: string) => void;
  readonly pid: number;
}

export interface OwnedLockRunResult<T> {
  readonly value: T;
  readonly releaseWarning?: string;
}

const DEFAULT_PLANLET_LOCK_DEPENDENCIES: PlanletLockDependencies = {
  write: (path, contents) =>
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx" }),
  rename: renameSync,
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  pid: process.pid,
};

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/**
 * mkdir applies its mode only when it creates the directory, so an existing
 * namespace has to be checked separately. The name is derived from the owner
 * and checkout path, which anyone on the machine can compute, so a hostile
 * user could pre-create it and plant holder files that never clear. A
 * namespace owned by someone else is refused outright; one of our own left
 * readable by an earlier version is tightened in place.
 */
function assertPrivateLockRoot(rootDir: string, label: string): void {
  const owner = process.getuid?.();
  // Windows has no POSIX ownership or mode bits to check.
  if (owner === undefined) return;
  const status = tryLstat(rootDir);
  if (status === null) return;

  if (status.uid !== owner) {
    throw new PlanletError(
      "unsafe_path",
      `Lock root is owned by another user: ${rootDir}`,
      {
        details: { label, rootDir, owner: status.uid },
        next: `Remove ${rootDir} if it is stale, or set TMPDIR to a directory you own`,
      },
    );
  }
  if ((status.mode & 0o777) !== 0o700) {
    try {
      chmodSync(rootDir, 0o700);
    } catch (error) {
      throw new PlanletError(
        "unsafe_path",
        `Could not restrict lock root permissions: ${rootDir}`,
        { details: { label, rootDir }, cause: error },
      );
    }
  }
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
 * "leave the path alone". The positive-integer check is not defensive noise:
 * process.kill addresses a process group for pid 0 and every permitted process
 * for pid -1, so a hand-edited lock file must never be treated as owned.
 */
function readOwnedLockHolder(path: string): OwnedLockHolder | null {
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
 * exists. Contending holders — live or dead — fail with write_conflict.
 *
 * Dead holders are not reclaimed automatically: remove-then-create admits two
 * writers when both observe the same dead lock. Until flock(2)/LockFileEx is
 * available, confirmed manual removal is the only recovery path.
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
    // 0o700: the namespace sits in a world-writable /tmp, so anyone able to
    // guess or list it could otherwise pre-create or read lock holders.
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  } catch (createError) {
    throw new PlanletError(
      "write_conflict",
      `Could not create lock root: ${label}`,
      { details: { label, rootDir }, cause: createError },
    );
  }
  assertNotSymlink(rootDir, label);
  assertPrivateLockRoot(rootDir, label);

  const lockPath = join(rootDir, lockName);
  assertNotSymlink(lockPath, label);

  const token = randomUUID();
  const holder: OwnedLockHolder = { pid: resolved.pid, token };
  try {
    resolved.write(lockPath, `${JSON.stringify(holder)}\n`);
    return { path: lockPath, token };
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new PlanletError(
        "write_conflict",
        `Resource is locked by another process: ${label}`,
        {
          details: { label, lockPath },
          cause: error,
          ...(nextHint === undefined ? {} : { next: nextHint }),
        },
      );
    }
    throw new PlanletError(
      "write_conflict",
      `Could not acquire lock: ${label}`,
      { details: { label, lockPath }, cause: error },
    );
  }
}

/**
 * Releases only when the caller's ownership token still matches after an
 * atomic rename aside. A pathname read followed by unlink cannot provide
 * ownership-checked deletion: the path can be replaced between the two.
 * Mismatched quarantine contents are restored to the lock path when possible.
 * Throws from rename/remove are not swallowed here once ownership is confirmed.
 */
export function releaseOwnedLock(
  handle: OwnedLockHandle,
  dependencies: Partial<
    Pick<PlanletLockDependencies, "rename" | "remove">
  > = {},
): void {
  const rename =
    dependencies.rename ?? DEFAULT_PLANLET_LOCK_DEPENDENCIES.rename;
  const remove =
    dependencies.remove ?? DEFAULT_PLANLET_LOCK_DEPENDENCIES.remove;
  const quarantine = `${handle.path}.${handle.token}.releasing`;

  try {
    rename(handle.path, quarantine);
  } catch {
    return;
  }

  const holder = readOwnedLockHolder(quarantine);
  if (holder === null || holder.token !== handle.token) {
    try {
      rename(quarantine, handle.path);
    } catch {
      // Path already retaken; leave the quarantine for manual recovery.
    }
    return;
  }
  try {
    remove(quarantine);
  } catch (error) {
    // Put the holder back on the canonical path so recovery hints stay valid.
    try {
      rename(quarantine, handle.path);
    } catch {
      // Quarantine remains; surface the original remove failure.
    }
    throw error;
  }
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

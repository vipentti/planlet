import { resolveSafePath } from "./paths.js";
import {
  OWNED_LOCK_HOLDER,
  acquireOwnedLock,
  releaseOwnedLock,
  withOwnedLock,
  type OwnedLockDependencies,
  type OwnedLockHandle,
  type OwnedLockHolder,
  type ProcessProbeResult,
} from "./owned-fs-lock.js";

export const PLANLET_LOCK_DIR = ".planlet-locks";
export const PLANLET_LOCK_HOLDER = OWNED_LOCK_HOLDER;
/** Reserved lock name for repository-wide harness install serialization. */
export const HARNESS_INSTALL_LOCK_NAME = "__harness__";

export type PlanletLockHolder = OwnedLockHolder;
export type PlanletLockHandle = OwnedLockHandle;
export type PlanletLockDependencies = OwnedLockDependencies;
export type { ProcessProbeResult };

export function planletLockPath(repositoryRoot: string, slug: string): string {
  return resolveSafePath(repositoryRoot, "plans", PLANLET_LOCK_DIR, slug);
}

function lockRoot(repositoryRoot: string): string {
  return resolveSafePath(repositoryRoot, "plans", PLANLET_LOCK_DIR);
}

export function acquirePlanletLock(
  repositoryRoot: string,
  slug: string,
  dependencies: Partial<PlanletLockDependencies> = {},
): PlanletLockHandle {
  return acquireOwnedLock(
    lockRoot(repositoryRoot),
    slug,
    slug,
    dependencies,
    `Retry after the other planlet operation finishes, or remove ${PLANLET_LOCK_DIR}/${slug} only if that process is confirmed dead`,
  );
}

export function releasePlanletLock(handle: PlanletLockHandle): void {
  releaseOwnedLock(handle);
}

export function withPlanletLock<T>(
  repositoryRoot: string,
  slug: string,
  operation: () => T,
  dependencies: Partial<PlanletLockDependencies> = {},
): T {
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
): T {
  return withOwnedLock(
    lockRoot(repositoryRoot),
    HARNESS_INSTALL_LOCK_NAME,
    "harness-install",
    operation,
    dependencies,
    `Retry after the other harness install finishes, or remove ${PLANLET_LOCK_DIR}/${HARNESS_INSTALL_LOCK_NAME} only if that process is confirmed dead`,
  );
}

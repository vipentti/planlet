import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

import type { PlanSummary } from "./models.js";
import { atomicPublish, resolveSafePath, tryLstat } from "./paths.js";
import { assertValidSlug, parseArchiveName } from "./slugs.js";
import { PlanletError, asWriteConflict } from "../errors/planlet-error.js";

export interface CreatePlanletOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly title?: string | undefined;
  readonly dependencies?: Partial<CreatePlanletDependencies> | undefined;
}

/**
 * Injected purely so tests can force each individual filesystem step to fail
 * and assert the rollback path. Production always uses DEFAULT_DEPENDENCIES.
 */
interface CreatePlanletDependencies {
  readonly writeFile: (path: string, content: string) => void;
  readonly rename: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  readonly temporaryName: (slug: string) => string;
}

const DEFAULT_DEPENDENCIES: CreatePlanletDependencies = {
  writeFile: (path, content) =>
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" }),
  rename: (source, destination) => renameSync(source, destination),
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  temporaryName: (slug) => `.${slug}.create-${randomUUID()}`,
};

function pathExists(path: string): boolean {
  return tryLstat(path) !== null;
}

export function deriveTitleFromSlug(slug: string): string {
  return assertValidSlug(slug)
    .split("-")
    .map((segment) =>
      segment.replace(/^[a-z]/, (letter) => letter.toUpperCase()),
    )
    .join(" ");
}

function validateCreationTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || /[\r\n]/.test(trimmed)) {
    throw new PlanletError(
      "invalid_plan",
      "Planlet title must be non-empty single-line text",
      { details: { title } },
    );
  }
  return trimmed;
}

function assertNoActiveCollision(plansPath: string, slug: string): void {
  const targetPath = resolveSafePath(plansPath, slug);
  if (pathExists(targetPath)) {
    throw new PlanletError(
      "plan_already_exists",
      `Active planlet already exists: ${slug}`,
      { details: { slug, path: targetPath } },
    );
  }
}

function assertNoCompletedCollision(plansPath: string, slug: string): void {
  const completedPath = resolveSafePath(plansPath, "completed");
  if (!pathExists(completedPath)) {
    return;
  }

  for (const archiveName of readdirSync(completedPath)) {
    if (parseArchiveName(archiveName)?.slug === slug) {
      throw new PlanletError(
        "completed_plan_exists",
        `Completed planlet already exists: ${slug}`,
        { details: { slug, archiveName } },
      );
    }
  }
}

/**
 * Creates a draft in a temporary sibling directory and publishes it with one
 * rename only after both complete stub files have been written.
 */
export function createPlanlet(options: CreatePlanletOptions): PlanSummary {
  const slug = assertValidSlug(options.slug);
  const title =
    options.title === undefined
      ? deriveTitleFromSlug(slug)
      : validateCreationTitle(options.title);
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };

  let plansPath: string;
  try {
    plansPath = resolveSafePath(options.repositoryRoot, "plans");
    mkdirSync(plansPath, { recursive: true });
    assertNoActiveCollision(plansPath, slug);
    assertNoCompletedCollision(plansPath, slug);
  } catch (error) {
    throw asWriteConflict(error, `Could not create planlet: ${slug}`, { slug });
  }

  const temporaryPath = resolveSafePath(
    plansPath,
    dependencies.temporaryName(slug),
  );
  const targetPath = resolveSafePath(plansPath, slug);
  atomicPublish({
    temporaryPath,
    targetPath,
    createTemporary: () => mkdirSync(temporaryPath),
    prepare: () => {
      dependencies.writeFile(
        resolveSafePath(temporaryPath, "plan.md"),
        `# ${title}\n`,
      );
      dependencies.writeFile(
        resolveSafePath(temporaryPath, "tasks.md"),
        `# Tasks: ${title}\n`,
      );
      // Recheck immediately before publication to narrow the collision race.
      assertNoActiveCollision(plansPath, slug);
      assertNoCompletedCollision(plansPath, slug);
    },
    rename: dependencies.rename,
    remove: dependencies.remove,
    onFailure: (error) =>
      asWriteConflict(error, `Could not create planlet: ${slug}`, { slug }),
    cleanupFailure: {
      code: "write_conflict",
      message: `Could not clean up failed planlet creation: ${slug}`,
      details: { slug, temporaryPath, cleanupFailed: true },
      aggregateMessage: `Planlet creation and cleanup failed: ${slug}`,
      fatal: true,
    },
  });

  return {
    slug,
    title,
    state: "draft",
    completedTasks: 0,
    totalTasks: 0,
    path: targetPath,
    warnings: [],
  };
}

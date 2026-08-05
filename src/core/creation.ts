import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

import type { PlanSummary } from "./models.js";
import { resolveSafePath, tryLstat } from "./paths.js";
import { assertValidSlug, parseArchiveName } from "./slugs.js";
import { PlanletError, isPlanletError } from "../errors/planlet-error.js";

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

function asWriteConflict(error: unknown, slug: string): PlanletError {
  if (isPlanletError(error)) {
    return error;
  }
  return new PlanletError(
    "write_conflict",
    `Could not create planlet: ${slug}`,
    {
      details: { slug },
      cause: error,
    },
  );
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
    throw asWriteConflict(error, slug);
  }

  const temporaryPath = resolveSafePath(
    plansPath,
    dependencies.temporaryName(slug),
  );
  const targetPath = resolveSafePath(plansPath, slug);
  let temporaryCreated = false;
  let published = false;
  let creationFailure: PlanletError | undefined;

  try {
    mkdirSync(temporaryPath);
    temporaryCreated = true;
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
    dependencies.rename(temporaryPath, targetPath);
    published = true;
  } catch (error) {
    creationFailure = asWriteConflict(error, slug);
  }

  if (temporaryCreated && !published) {
    try {
      dependencies.remove(temporaryPath);
    } catch (cleanupFailure) {
      const causes =
        creationFailure === undefined
          ? [cleanupFailure]
          : [creationFailure, cleanupFailure];
      throw new PlanletError(
        "write_conflict",
        `Could not clean up failed planlet creation: ${slug}`,
        {
          details: { slug, temporaryPath, cleanupFailed: true },
          cause: new AggregateError(
            causes,
            `Planlet creation and cleanup failed: ${slug}`,
          ),
        },
      );
    }
  }

  if (creationFailure !== undefined) {
    throw creationFailure;
  }

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

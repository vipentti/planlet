import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { resolve } from "node:path";

import { createPlanSummary, type PlanSummary } from "./models.js";
import { resolveSafePath, tryLstat } from "./paths.js";
import {
  assertValidSlug,
  createArchiveName,
  parseArchiveName,
} from "./slugs.js";
import { validatePlanletStructure } from "./validation.js";
import { isPlanletError, PlanletError } from "../errors/planlet-error.js";

export interface CompletePlanletOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly allowIncomplete?: boolean | undefined;
  readonly reason?: string | undefined;
  readonly dependencies?: Partial<CompletePlanletDependencies> | undefined;
}

export interface CompletePlanletDependencies {
  readonly now: () => Date;
  readonly writeFile: (path: string, content: string, mode: number) => void;
  readonly replaceFile: (source: string, destination: string) => void;
  readonly moveDirectory: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  readonly temporaryName: (slug: string) => string;
}

export interface CompletePlanletResult {
  readonly slug: string;
  readonly archiveName: string;
  readonly destination: string;
  readonly completedAt: string;
  readonly mode: "normal" | "incomplete override";
  readonly remainingTaskIds: readonly string[];
  readonly summary: PlanSummary;
}

const DEFAULT_DEPENDENCIES: CompletePlanletDependencies = {
  now: () => new Date(),
  writeFile: (path, content, mode) =>
    writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode }),
  replaceFile: (source, destination) => renameSync(source, destination),
  moveDirectory: (source, destination) => renameSync(source, destination),
  remove: (path) => rmSync(path, { force: true }),
  temporaryName: (slug) => `.${slug}.completion-${randomUUID()}.tmp`,
};

function readMarkdown(path: string, filename: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new PlanletError("invalid_plan", `Cannot read ${filename}`, {
      details: { path },
      cause: error,
    });
  }
}

function normalizedReason(reason: string | undefined, slug: string): string {
  const value = reason?.trim() ?? "";
  if (value.length === 0 || /[\r\n]/.test(value)) {
    throw new PlanletError(
      "incomplete_tasks",
      "Incomplete completion requires a non-empty single-line reason",
      { details: { slug, reasonRequired: true } },
    );
  }
  return value;
}

function assertActivePlanletDirectory(path: string, slug: string): void {
  const status = tryLstat(path);
  if (status?.isSymbolicLink()) {
    throw new PlanletError(
      "unsafe_path",
      `Planlet directory must not be a symbolic link: ${slug}`,
      { details: { slug, path } },
    );
  }
  if (!status?.isDirectory()) {
    throw new PlanletError("plan_not_found", `Planlet not found: ${slug}`, {
      details: { slug },
    });
  }
}

function appendCompletionRecord(
  markdown: string,
  completedAt: string,
  remainingTaskIds: readonly string[],
  reason: string | undefined,
): string {
  const separator = markdown.endsWith("\n\n")
    ? ""
    : markdown.endsWith("\n")
      ? "\n"
      : "\n\n";
  const lines = [
    "## Completion",
    "",
    `- Completed at: ${completedAt}`,
    `- Mode: ${reason === undefined ? "normal" : "incomplete override"}`,
  ];
  if (reason !== undefined) {
    lines.push(`- Remaining tasks: ${remainingTaskIds.join(", ")}`);
    lines.push(`- Reason: ${reason}`);
  }
  return `${markdown}${separator}${lines.join("\n")}\n`;
}

function assertNoCompletionCollision(
  completedPath: string,
  slug: string,
  destination: string,
): void {
  if (tryLstat(destination) !== null) {
    throw new PlanletError(
      "archive_collision",
      `Completion destination already exists: ${destination}`,
      { details: { slug, destination } },
    );
  }

  if (tryLstat(completedPath) === null) {
    return;
  }
  for (const name of readdirSync(completedPath)) {
    if (parseArchiveName(name)?.slug === slug) {
      throw new PlanletError(
        "completed_plan_exists",
        `Completed planlet already exists: ${slug}`,
        { details: { slug, archiveName: name } },
      );
    }
  }
}

function asWriteConflict(
  error: unknown,
  slug: string,
  details: Readonly<Record<string, unknown>> = {},
): PlanletError {
  if (isPlanletError(error)) {
    return error;
  }
  return new PlanletError(
    "write_conflict",
    `Could not complete planlet: ${slug}`,
    {
      details: { slug, ...details },
      cause: error,
    },
  );
}

function resumeRecordedCompletion(
  options: CompletePlanletOptions,
  dependencies: CompletePlanletDependencies,
  source: string,
  planMarkdown: string,
  tasksMarkdown: string,
): CompletePlanletResult {
  const slug = options.slug;
  const active = validatePlanletStructure({
    directoryName: slug,
    location: "active",
    planMarkdown,
    tasksMarkdown,
  });
  const completion = active.completion;
  if (completion === null) {
    throw new TypeError("Recorded completion is required");
  }

  const remainingTaskIds = active.tasks
    .filter((task) => !task.completed)
    .map((task) => task.id);
  if (completion.mode === "normal" && remainingTaskIds.length > 0) {
    throw new PlanletError(
      "invalid_plan",
      "Normal completion record cannot contain unchecked tasks",
      { details: { slug, remaining: remainingTaskIds } },
    );
  }

  const instant = new Date(completion.completedAt);
  const archiveName = createArchiveName(slug, instant);
  const completedValidation = validatePlanletStructure({
    directoryName: archiveName,
    location: "completed",
    planMarkdown,
    tasksMarkdown,
  });

  let completedPath: string;
  let destination: string;
  try {
    completedPath = resolveSafePath(
      options.repositoryRoot,
      "plans",
      "completed",
    );
    destination = resolveSafePath(
      options.repositoryRoot,
      "plans",
      "completed",
      archiveName,
    );
    assertNoCompletionCollision(completedPath, slug, destination);
    mkdirSync(completedPath, { recursive: true });
    assertNoCompletionCollision(completedPath, slug, destination);
    assertActivePlanletDirectory(source, slug);
    dependencies.moveDirectory(source, destination);
  } catch (error) {
    throw asWriteConflict(error, slug, {
      source,
      auditRecorded: true,
      resumeAttempted: true,
    });
  }

  const completedTasks = active.tasks.length - remainingTaskIds.length;
  return {
    slug,
    archiveName,
    destination,
    completedAt: completion.completedAt,
    mode: completion.mode,
    remainingTaskIds,
    summary: createPlanSummary({
      slug,
      archiveName,
      completedAt: completion.completedAt,
      title: active.title,
      state: "completed",
      completedTasks,
      totalTasks: active.tasks.length,
      path: destination,
      warnings: completedValidation.warnings,
    }),
  };
}

/**
 * Records completion with an atomic tasks.md replacement, then moves the whole
 * planlet. The clock is read exactly once and that instant determines both the
 * audit timestamp and archive date.
 */
export function completePlanlet(
  options: CompletePlanletOptions,
): CompletePlanletResult {
  const slug = assertValidSlug(options.slug);
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const plansPath = resolveSafePath(options.repositoryRoot, "plans");
  // Keep the lexical planlet entry as the move source. resolveSafePath follows
  // symlinks, which is correct for containment checks but unsafe for a rename.
  const source = resolve(plansPath, slug);
  assertActivePlanletDirectory(source, slug);

  const planPath = resolveSafePath(source, "plan.md");
  const tasksPath = resolveSafePath(source, "tasks.md");
  const planMarkdown = readMarkdown(planPath, "plan.md");
  const tasksMarkdown = readMarkdown(tasksPath, "tasks.md");
  const validated = validatePlanletStructure({
    directoryName: slug,
    location: "active",
    planMarkdown,
    tasksMarkdown,
  });
  if (validated.completion !== null) {
    return resumeRecordedCompletion(
      options,
      dependencies,
      source,
      planMarkdown,
      tasksMarkdown,
    );
  }

  const remainingTaskIds = validated.tasks
    .filter((task) => !task.completed)
    .map((task) => task.id);
  if (validated.state !== "ready_to_complete") {
    const completed = validated.tasks.length - remainingTaskIds.length;
    if (remainingTaskIds.length === 0 || options.allowIncomplete !== true) {
      throw new PlanletError(
        "incomplete_tasks",
        validated.state === "draft"
          ? "Draft planlet cannot be completed"
          : "Planlet has incomplete tasks",
        {
          details: {
            slug,
            state: validated.state,
            completed,
            total: validated.tasks.length,
            remaining: remainingTaskIds,
          },
          ...(remainingTaskIds.length > 0
            ? { next: `planlet tasks ${slug} --remaining` }
            : {}),
        },
      );
    }
  }
  const reason =
    remainingTaskIds.length > 0
      ? normalizedReason(options.reason, slug)
      : undefined;

  // Capture one instant. Do not call the injected clock again.
  const instant = dependencies.now();
  let completedAt: string;
  try {
    completedAt = instant.toISOString();
  } catch (error) {
    throw new PlanletError("invalid_plan", "Invalid completion timestamp", {
      details: { slug },
      cause: error,
    });
  }
  const archiveName = createArchiveName(slug, instant);

  let completedPath: string;
  let destination: string;
  try {
    completedPath = resolveSafePath(
      options.repositoryRoot,
      "plans",
      "completed",
    );
    destination = resolveSafePath(
      options.repositoryRoot,
      "plans",
      "completed",
      archiveName,
    );
    assertNoCompletionCollision(completedPath, slug, destination);
    mkdirSync(completedPath, { recursive: true });
    assertNoCompletionCollision(completedPath, slug, destination);
  } catch (error) {
    throw asWriteConflict(error, slug);
  }

  // Fail if the source was replaced with a symlink while completion was being
  // prepared. The lexical entry remains the only directory we ever move.
  assertActivePlanletDirectory(source, slug);

  const updatedTasks = appendCompletionRecord(
    tasksMarkdown,
    completedAt,
    remainingTaskIds,
    reason,
  );
  validatePlanletStructure({
    directoryName: archiveName,
    location: "completed",
    planMarkdown,
    tasksMarkdown: updatedTasks,
  });

  const temporaryPath = resolveSafePath(
    source,
    dependencies.temporaryName(slug),
  );
  let temporaryCreated = false;
  let auditPublished = false;
  try {
    const mode = statSync(tasksPath).mode & 0o777;
    dependencies.writeFile(temporaryPath, updatedTasks, mode);
    temporaryCreated = true;
    dependencies.replaceFile(temporaryPath, tasksPath);
    auditPublished = true;
  } catch (error) {
    if (temporaryCreated && !auditPublished) {
      try {
        dependencies.remove(temporaryPath);
      } catch (cleanupFailure) {
        throw new PlanletError(
          "write_conflict",
          `Could not clean up failed completion audit: ${slug}`,
          {
            details: { slug, temporaryPath, cleanupFailed: true },
            cause: new AggregateError([error, cleanupFailure]),
          },
        );
      }
    }
    throw asWriteConflict(error, slug, { auditRecorded: false });
  }

  try {
    // Recheck after recording the audit and immediately before movement.
    assertNoCompletionCollision(completedPath, slug, destination);
    assertActivePlanletDirectory(source, slug);
    dependencies.moveDirectory(source, destination);
  } catch (error) {
    let rollbackCreated = false;
    let rollbackPublished = false;
    let rollbackFailure: unknown;
    let rollbackPath: string | undefined;
    try {
      rollbackPath = resolveSafePath(source, dependencies.temporaryName(slug));
      const mode = statSync(tasksPath).mode & 0o777;
      dependencies.writeFile(rollbackPath, tasksMarkdown, mode);
      rollbackCreated = true;
      dependencies.replaceFile(rollbackPath, tasksPath);
      rollbackPublished = true;
    } catch (rollbackError) {
      rollbackFailure = rollbackError;
    }

    if (rollbackCreated && !rollbackPublished && rollbackPath !== undefined) {
      try {
        dependencies.remove(rollbackPath);
      } catch (cleanupError) {
        rollbackFailure = new AggregateError(
          rollbackFailure === undefined
            ? [cleanupError]
            : [rollbackFailure, cleanupError],
          `Completion movement and rollback cleanup failed: ${slug}`,
        );
      }
    }

    if (rollbackPublished) {
      throw asWriteConflict(error, slug, {
        source,
        destination,
        auditRecorded: false,
        auditRolledBack: true,
      });
    }
    throw asWriteConflict(error, slug, {
      source,
      destination,
      auditRecorded: true,
      auditRollbackFailed: true,
      ...(rollbackFailure === undefined ? {} : { rollbackFailure: true }),
    });
  }

  const completedTasks = validated.tasks.length - remainingTaskIds.length;
  const mode = reason === undefined ? "normal" : "incomplete override";
  return {
    slug,
    archiveName,
    destination,
    completedAt,
    mode,
    remainingTaskIds,
    summary: createPlanSummary({
      slug,
      archiveName,
      completedAt,
      title: validated.title,
      state: "completed",
      completedTasks,
      totalTasks: validated.tasks.length,
      path: destination,
      warnings: [
        ...validated.warnings,
        ...(mode === "incomplete override"
          ? ["Completed planlet contains an incomplete-task override"]
          : []),
      ],
    }),
  };
}

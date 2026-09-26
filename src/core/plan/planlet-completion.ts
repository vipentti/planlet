import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { resolve } from "node:path";

import type { PlanSummary } from "./models.js";
import {
  withPlanletLock,
  type PlanletLockDependencies,
} from "../planlet-lock.js";
import { assertActivePlanletDirectory, readMarkdown } from "./planlet-files.js";
import {
  rewriteOutgoingLinks,
  type LinkRewriteOutcome,
  type LinkTargetExistence,
} from "./link-rewrite.js";
import { atomicPublish, resolveSafePath, tryLstat } from "../paths.js";
import { tryStageMove } from "../git.js";
import {
  assertValidSlug,
  createArchiveName,
  parseArchiveName,
} from "./slugs.js";
import { validatePlanletStructure } from "./validation.js";
import { PlanletError, asWriteConflict } from "../../errors/planlet-error.js";

export interface CompletePlanletOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly allowIncomplete?: boolean | undefined;
  readonly reason?: string | undefined;
  readonly dependencies?: Partial<CompletePlanletDependencies> | undefined;
}

interface CompletePlanletDependencies {
  readonly now: () => Date;
  readonly writeFile: (path: string, content: string, mode: number) => void;
  readonly replaceFile: (source: string, destination: string) => void;
  readonly moveDirectory: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  readonly temporaryName: (slug: string) => string;
  readonly linkTargetExists?: ((absolutePath: string) => boolean) | undefined;
  readonly lock?: Partial<PlanletLockDependencies>;
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

function linkExistence(
  repositoryRoot: string,
  dependencies: CompletePlanletDependencies,
): LinkTargetExistence {
  const probe = dependencies.linkTargetExists;
  if (probe !== undefined) {
    return { exists: probe };
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(repositoryRoot);
  } catch {
    canonicalRoot = repositoryRoot;
  }
  // tryLstat follows the containment-safe convention: join against the
  // canonical root so symlinked checkout paths still resolve, matching
  // resolveSafePath. The lexical `repositoryRoot/relative` join and the
  // canonical join denote the same file; probe both.
  return {
    exists: (absolutePath) =>
      tryLstat(absolutePath) !== null ||
      tryLstat(
        `${canonicalRoot}${absolutePath.slice(repositoryRoot.length)}`,
      ) !== null,
  };
}

/** Warns about rewrites and skipped destinations in both plan files. */
function linkRewriteWarnings(
  rewrittenPlan: LinkRewriteOutcome,
  rewrittenTasks: LinkRewriteOutcome,
): string[] {
  const warnings: string[] = [];
  if (rewrittenPlan.rewritten > 0) {
    warnings.push(
      `Rewrote ${rewrittenPlan.rewritten} relative link${rewrittenPlan.rewritten === 1 ? "" : "s"} in plan.md for the archived location`,
    );
  }
  if (rewrittenTasks.rewritten > 0) {
    warnings.push(
      `Rewrote ${rewrittenTasks.rewritten} relative link${rewrittenTasks.rewritten === 1 ? "" : "s"} in tasks.md for the archived location`,
    );
  }
  for (const skipped of rewrittenPlan.skipped) {
    warnings.push(`plan.md link left unchanged (${skipped})`);
  }
  for (const skipped of rewrittenTasks.skipped) {
    warnings.push(`tasks.md link left unchanged (${skipped})`);
  }
  return warnings;
}

/** Removes the trailing `## Completion` audit record, if present. */
function stripCompletionRecord(tasksMarkdown: string): string {
  const marker = "\n## Completion";
  const index = tasksMarkdown.lastIndexOf(marker);
  if (index === -1) return tasksMarkdown;
  const tail = tasksMarkdown.slice(index + 1);
  if (!/^## Completion\n\n- Completed at: /.test(tail)) return tasksMarkdown;
  return tasksMarkdown.slice(0, index) + (index === 0 ? "" : "\n");
}

/** Atomically publishes a rewritten plan file when it differs. */
function publishRewrittenFile(options: {
  options: CompletePlanletOptions;
  dependencies: CompletePlanletDependencies;
  slug: string;
  source: string;
  filePath: string;
  original: string;
  rewritten: string;
  auditRecorded: boolean;
  temporarySuffix: string;
}): void {
  if (options.rewritten === options.original) return;
  const temporaryPath = resolveSafePath(
    options.source,
    options.dependencies.temporaryName(
      `${options.slug}${options.temporarySuffix}`,
    ),
  );
  atomicPublish({
    temporaryPath,
    targetPath: options.filePath,
    createTemporary: () => {
      // Mode lookup stays inside the publish error boundary so a missing
      // or inaccessible file maps to write_conflict like every other
      // completion write failure.
      const mode = statSync(options.filePath).mode & 0o777;
      options.dependencies.writeFile(temporaryPath, options.rewritten, mode);
    },
    rename: options.dependencies.replaceFile,
    remove: options.dependencies.remove,
    onFailure: (error) =>
      asWriteConflict(error, `Could not complete planlet: ${options.slug}`, {
        slug: options.slug,
        auditRecorded: options.auditRecorded,
      }),
    cleanupFailure: {
      code: "write_conflict",
      message: `Could not clean up failed completion rewrite: ${options.slug}`,
      details: {
        slug: options.slug,
        temporaryPath,
        cleanupFailed: true,
      },
      fatal: true,
    },
  });
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

  // Finish any pending link rewrites before moving: a crash between the
  // tasks.md audit publish and the plan.md rewrite publish leaves the
  // audit durable while plan.md still holds pre-archive destinations.
  const planDir = `plans/${slug}`;
  const existence = linkExistence(options.repositoryRoot, dependencies);
  const rewrittenPlan = rewriteOutgoingLinks(
    planMarkdown,
    planDir,
    existence,
    options.repositoryRoot,
  );
  const rewrittenTasks = rewriteOutgoingLinks(
    stripCompletionRecord(tasksMarkdown),
    planDir,
    existence,
    options.repositoryRoot,
  );
  const linkWarnings: string[] = linkRewriteWarnings(
    rewrittenPlan,
    rewrittenTasks,
  );
  const rewrittenPlanMarkdown = rewrittenPlan.text;
  const rewrittenTasksMarkdown =
    rewrittenTasks.text === stripCompletionRecord(tasksMarkdown)
      ? tasksMarkdown
      : appendCompletionRecord(
          rewrittenTasks.text,
          completion.completedAt,
          remainingTaskIds,
          completion.mode === "incomplete override"
            ? completion.reason
            : undefined,
        );
  const completedValidation = validatePlanletStructure({
    directoryName: archiveName,
    location: "completed",
    planMarkdown: rewrittenPlanMarkdown,
    tasksMarkdown: rewrittenTasksMarkdown,
  });

  const planPath = resolveSafePath(source, "plan.md");
  const tasksPath = resolveSafePath(source, "tasks.md");
  publishRewrittenFile({
    options,
    dependencies,
    slug,
    source,
    filePath: planPath,
    original: planMarkdown,
    rewritten: rewrittenPlanMarkdown,
    auditRecorded: true,
    temporarySuffix: "-plan",
  });
  publishRewrittenFile({
    options,
    dependencies,
    slug,
    source,
    filePath: tasksPath,
    original: tasksMarkdown,
    rewritten: rewrittenTasksMarkdown,
    auditRecorded: true,
    temporarySuffix: "-tasks-resume",
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
    throw asWriteConflict(error, `Could not complete planlet: ${slug}`, {
      slug,
      source,
      auditRecorded: true,
      resumeAttempted: true,
    });
  }

  const completedTasks = active.tasks.length - remainingTaskIds.length;
  const warnings = [...completedValidation.warnings, ...linkWarnings];
  tryStageMove(options.repositoryRoot, source, destination, warnings);
  return {
    slug,
    archiveName,
    destination,
    completedAt: completion.completedAt,
    mode: completion.mode,
    remainingTaskIds,
    summary: {
      slug,
      archiveName,
      completedAt: completion.completedAt,
      title: active.title,
      state: "completed",
      completedTasks,
      totalTasks: active.tasks.length,
      path: destination,
      warnings,
    },
  };
}

/**
 * Records completion with an atomic tasks.md replacement, then moves the whole
 * planlet. The clock is read exactly once and that instant determines both the
 * audit timestamp and archive date. The full sequence runs under the per-planlet
 * write lock shared with task updates.
 */
export function completePlanlet(
  options: CompletePlanletOptions,
): CompletePlanletResult {
  const slug = assertValidSlug(options.slug);
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const { value, releaseWarning } = withPlanletLock(
    options.repositoryRoot,
    slug,
    () => completePlanletLocked(options, dependencies, slug),
    dependencies.lock,
  );
  if (releaseWarning === undefined) return value;
  return {
    ...value,
    summary: {
      ...value.summary,
      warnings: [...value.summary.warnings, releaseWarning],
    },
  };
}

function completePlanletLocked(
  options: CompletePlanletOptions,
  dependencies: CompletePlanletDependencies,
  slug: string,
): CompletePlanletResult {
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
    throw asWriteConflict(error, `Could not complete planlet: ${slug}`, {
      slug,
    });
  }

  // Fail if the source was replaced with a symlink while completion was being
  // prepared. The lexical entry remains the only directory we ever move.
  assertActivePlanletDirectory(source, slug);

  // The archive directory sits one level deeper than the active planlet, so
  // relative links that escape the plan directory break by exactly one
  // `../` level. Rewrite those destinations before the move; internal links
  // stay byte-identical. Pre-written archived-depth links and dangling links
  // are left untouched.
  const planDir = `plans/${slug}`;
  const existence = linkExistence(options.repositoryRoot, dependencies);
  const rewrittenPlan = rewriteOutgoingLinks(
    planMarkdown,
    planDir,
    existence,
    options.repositoryRoot,
  );
  const rewrittenTasks = rewriteOutgoingLinks(
    tasksMarkdown,
    planDir,
    existence,
    options.repositoryRoot,
  );
  const linkWarnings = linkRewriteWarnings(rewrittenPlan, rewrittenTasks);
  const rewrittenPlanMarkdown = rewrittenPlan.text;
  const rewrittenTasksMarkdown = rewrittenTasks.text;

  const updatedTasks = appendCompletionRecord(
    rewrittenTasksMarkdown,
    completedAt,
    remainingTaskIds,
    reason,
  );
  validatePlanletStructure({
    directoryName: archiveName,
    location: "completed",
    planMarkdown: rewrittenPlanMarkdown,
    tasksMarkdown: updatedTasks,
  });

  const temporaryPath = resolveSafePath(
    source,
    dependencies.temporaryName(slug),
  );
  // Publish tasks.md first: the audit write is the crash-recovery point and
  // the resume path must observe the rewritten text, never the original.
  atomicPublish({
    temporaryPath,
    targetPath: tasksPath,
    createTemporary: () => {
      const mode = statSync(tasksPath).mode & 0o777;
      dependencies.writeFile(temporaryPath, updatedTasks, mode);
    },
    rename: dependencies.replaceFile,
    remove: dependencies.remove,
    onFailure: (error) =>
      asWriteConflict(error, `Could not complete planlet: ${slug}`, {
        slug,
        auditRecorded: false,
      }),
    cleanupFailure: {
      code: "write_conflict",
      message: `Could not clean up failed completion audit: ${slug}`,
      details: { slug, temporaryPath, cleanupFailed: true },
      fatal: true,
    },
  });

  // Publish plan.md through a second atomic write so a crash between the
  // two publishes resumes with the tasks.md audit already in place.
  publishRewrittenFile({
    options,
    dependencies,
    slug,
    source,
    filePath: planPath,
    original: planMarkdown,
    rewritten: rewrittenPlanMarkdown,
    auditRecorded: true,
    temporarySuffix: "-plan",
  });

  try {
    // Recheck after recording the audit and immediately before movement.
    assertNoCompletionCollision(completedPath, slug, destination);
    assertActivePlanletDirectory(source, slug);
    dependencies.moveDirectory(source, destination);
  } catch (error) {
    // Leave the published audit in place. Rewriting tasks.md here could clobber
    // concurrent edits; resumeRecordedCompletion can finish the move later.
    throw asWriteConflict(error, `Could not complete planlet: ${slug}`, {
      slug,
      source,
      destination,
      auditRecorded: true,
      auditRolledBack: false,
    });
  }

  const completedTasks = validated.tasks.length - remainingTaskIds.length;
  const mode = reason === undefined ? "normal" : "incomplete override";
  const warnings = [...validated.warnings, ...linkWarnings];
  if (mode === "incomplete override") {
    warnings.push("Completed planlet contains an incomplete-task override");
  }
  tryStageMove(options.repositoryRoot, source, destination, warnings);
  return {
    slug,
    archiveName,
    destination,
    completedAt,
    mode,
    remainingTaskIds,
    summary: {
      slug,
      archiveName,
      completedAt,
      title: validated.title,
      state: "completed",
      completedTasks,
      totalTasks: validated.tasks.length,
      path: destination,
      warnings,
    },
  };
}

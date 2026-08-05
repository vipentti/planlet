import { randomUUID } from "node:crypto";
import { renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PlanletState, PlanletTask } from "./models.js";
import { deriveLifecycleState } from "./status.js";
import {
  withPlanletLock,
  type PlanletLockDependencies,
} from "./planlet-lock.js";
import { assertActivePlanletDirectory, readMarkdown } from "./planlet-files.js";
import { atomicPublish, resolveSafePath } from "./paths.js";
import { assertValidSlug } from "./slugs.js";
import { parseTaskLine } from "./task-parser.js";
import { validatePlanletStructure } from "./validation.js";
import { PlanletError, asWriteConflict } from "../errors/planlet-error.js";

type TaskUpdateOperation = "check" | "uncheck";

export interface UpdateTaskOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly taskId: string;
  readonly operation: TaskUpdateOperation;
  readonly dependencies?: Partial<UpdateTaskDependencies>;
}

/** Fault-injection seam for the rollback tests; see CreatePlanletDependencies. */
interface UpdateTaskDependencies {
  readonly writeFile: (path: string, content: string, mode: number) => void;
  readonly rename: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  readonly temporaryName: (slug: string) => string;
  readonly lock?: Partial<PlanletLockDependencies>;
}

export interface UpdateTaskResult {
  readonly slug: string;
  readonly task: PlanletTask;
  readonly changed: boolean;
  readonly state: PlanletState;
  readonly done: number;
  readonly total: number;
  /** Next-action hint; present only when the plan is ready to complete. */
  readonly next?: string;
  readonly warnings: readonly string[];
}

const DEFAULT_DEPENDENCIES: UpdateTaskDependencies = {
  writeFile: (path, content, mode) =>
    writeFileSync(path, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    }),
  rename: (source, destination) => renameSync(source, destination),
  remove: (path) => rmSync(path, { force: true }),
  temporaryName: (slug) => `.${slug}.tasks-${randomUUID()}.tmp`,
};

function summarize(
  slug: string,
  tasks: readonly PlanletTask[],
): Pick<UpdateTaskResult, "state" | "done" | "total" | "next"> {
  const state = deriveLifecycleState({
    valid: true,
    location: "active",
    tasks,
  });
  const done = tasks.filter((task) => task.completed).length;
  return {
    state,
    done,
    total: tasks.length,
    ...(state === "ready_to_complete"
      ? { next: `planlet complete ${slug}` }
      : {}),
  };
}

function replaceTaskMarker(
  markdown: string,
  taskId: string,
  completed: boolean,
): string {
  let matched = false;
  // The lookbehind split keeps each line's terminator attached, so CR/LF and a
  // missing final newline all round-trip without reassembly.
  const updated = markdown.split(/(?<=\n)/).map((chunk) => {
    const ending = /\r?\n$/.exec(chunk)?.[0] ?? "";
    const task = parseTaskLine(chunk.slice(0, chunk.length - ending.length));
    if (task?.id !== taskId) {
      return chunk;
    }

    matched = true;
    return `- [${completed ? "x" : " "}] ${task.id} ${task.description}${ending}`;
  });

  if (!matched) {
    throw new PlanletError("task_not_found", `Task not found: ${taskId}`, {
      details: { taskId },
    });
  }
  return updated.join("");
}

/**
 * Checks or unchecks one task by atomically replacing tasks.md with a prepared
 * sibling file. Already-satisfied updates return without touching the file.
 * The full read-modify-write runs under the per-planlet write lock.
 */
export function updateTask(options: UpdateTaskOptions): UpdateTaskResult {
  const slug = assertValidSlug(options.slug);
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const { value, releaseWarning } = withPlanletLock(
    options.repositoryRoot,
    slug,
    () => updateTaskLocked(options, dependencies, slug),
    dependencies.lock,
  );
  if (releaseWarning === undefined) return value;
  return { ...value, warnings: [...value.warnings, releaseWarning] };
}

function updateTaskLocked(
  options: UpdateTaskOptions,
  dependencies: UpdateTaskDependencies,
  slug: string,
): UpdateTaskResult {
  const plansPath = resolveSafePath(options.repositoryRoot, "plans");
  const planletPath = resolve(plansPath, slug);
  assertActivePlanletDirectory(planletPath, slug);

  const planPath = resolveSafePath(planletPath, "plan.md");
  const tasksPath = resolveSafePath(planletPath, "tasks.md");
  const planMarkdown = readMarkdown(planPath, "plan.md");
  const tasksMarkdown = readMarkdown(tasksPath, "tasks.md");
  const validated = validatePlanletStructure({
    directoryName: slug,
    location: "active",
    planMarkdown,
    tasksMarkdown,
  });
  const task = validated.tasks.find(
    (candidate) => candidate.id === options.taskId,
  );
  if (task === undefined) {
    throw new PlanletError(
      "task_not_found",
      `Task not found: ${options.taskId}`,
      {
        details: { slug, taskId: options.taskId },
      },
    );
  }

  const completed = options.operation === "check";
  if (task.completed === completed) {
    return {
      slug,
      task,
      changed: false,
      ...summarize(slug, validated.tasks),
      warnings: validated.warnings,
    };
  }

  if (validated.completion !== null) {
    throw new PlanletError(
      "invalid_plan",
      "Tasks cannot be changed after completion has been recorded",
      {
        details: { slug, taskId: task.id },
        next: `planlet complete ${slug}`,
      },
    );
  }

  const updatedMarkdown = replaceTaskMarker(tasksMarkdown, task.id, completed);
  const revalidated = validatePlanletStructure({
    directoryName: slug,
    location: "active",
    planMarkdown,
    tasksMarkdown: updatedMarkdown,
  });

  const temporaryPath = resolveSafePath(
    planletPath,
    dependencies.temporaryName(slug),
  );
  atomicPublish({
    temporaryPath,
    targetPath: tasksPath,
    createTemporary: () => {
      const mode = statSync(tasksPath).mode & 0o777;
      dependencies.writeFile(temporaryPath, updatedMarkdown, mode);
    },
    rename: dependencies.rename,
    remove: dependencies.remove,
    onFailure: (error) =>
      asWriteConflict(error, `Could not update task: ${task.id}`, {
        slug,
        taskId: task.id,
      }),
    cleanupFailure: {
      code: "write_conflict",
      message: `Could not clean up failed task update: ${task.id}`,
      details: {
        slug,
        taskId: task.id,
        temporaryPath,
        cleanupFailed: true,
      },
      aggregateMessage: `Task update and cleanup failed: ${task.id}`,
      fatal: true,
    },
  });

  return {
    slug,
    task: { ...task, completed },
    changed: true,
    ...summarize(slug, revalidated.tasks),
    warnings: validated.warnings,
  };
}

import { randomUUID } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import type { PlanletTask } from "./models.js";
import { resolveSafePath } from "./paths.js";
import { assertValidSlug } from "./slugs.js";
import { parseTaskLine } from "./task-parser.js";
import { validatePlanletStructure } from "./validation.js";
import { isPlanletError, PlanletError } from "../errors/planlet-error.js";

export type TaskUpdateOperation = "check" | "uncheck";

export interface UpdateTaskOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly taskId: string;
  readonly operation: TaskUpdateOperation;
  readonly dependencies?: Partial<UpdateTaskDependencies>;
}

export interface UpdateTaskDependencies {
  readonly writeFile: (path: string, content: string, mode: number) => void;
  readonly rename: (source: string, destination: string) => void;
  readonly remove: (path: string) => void;
  readonly temporaryName: (slug: string) => string;
}

export interface UpdateTaskResult {
  readonly slug: string;
  readonly task: PlanletTask;
  readonly changed: boolean;
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

function assertActivePlanletDirectory(path: string, slug: string): void {
  let status: ReturnType<typeof lstatSync> | null;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
    status = null;
  }
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

function replaceTaskMarker(
  markdown: string,
  taskId: string,
  completed: boolean,
): string {
  let matched = false;
  const chunks = markdown.match(/[^\n]*(?:\n|$)/g) ?? [];
  const updated = chunks.map((chunk) => {
    if (chunk === "") {
      return chunk;
    }

    const ending = chunk.endsWith("\r\n")
      ? "\r\n"
      : chunk.endsWith("\n")
        ? "\n"
        : "";
    const line = ending === "" ? chunk : chunk.slice(0, -ending.length);
    const task = parseTaskLine(line);
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

function asWriteConflict(
  error: unknown,
  slug: string,
  taskId: string,
): PlanletError {
  if (isPlanletError(error)) {
    return error;
  }
  return new PlanletError(
    "write_conflict",
    `Could not update task: ${taskId}`,
    {
      details: { slug, taskId },
      cause: error,
    },
  );
}

/**
 * Checks or unchecks one task by atomically replacing tasks.md with a prepared
 * sibling file. Already-satisfied updates return without touching the file.
 */
export function updateTask(options: UpdateTaskOptions): UpdateTaskResult {
  const slug = assertValidSlug(options.slug);
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
    return Object.freeze({
      slug,
      task,
      changed: false,
      warnings: validated.warnings,
    });
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
  validatePlanletStructure({
    directoryName: slug,
    location: "active",
    planMarkdown,
    tasksMarkdown: updatedMarkdown,
  });

  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const temporaryPath = resolveSafePath(
    planletPath,
    dependencies.temporaryName(slug),
  );
  let temporaryCreated = false;
  let published = false;
  let updateFailure: PlanletError | undefined;

  try {
    const mode = statSync(tasksPath).mode & 0o777;
    dependencies.writeFile(temporaryPath, updatedMarkdown, mode);
    temporaryCreated = true;
    dependencies.rename(temporaryPath, tasksPath);
    published = true;
  } catch (error) {
    updateFailure = asWriteConflict(error, slug, task.id);
  }

  if (temporaryCreated && !published) {
    try {
      dependencies.remove(temporaryPath);
    } catch (cleanupFailure) {
      throw new PlanletError(
        "write_conflict",
        `Could not clean up failed task update: ${task.id}`,
        {
          details: {
            slug,
            taskId: task.id,
            temporaryPath,
            cleanupFailed: true,
          },
          cause: new AggregateError(
            updateFailure === undefined
              ? [cleanupFailure]
              : [updateFailure, cleanupFailure],
            `Task update and cleanup failed: ${task.id}`,
          ),
        },
      );
    }
  }

  if (updateFailure !== undefined) {
    throw updateFailure;
  }

  return Object.freeze({
    slug,
    task: Object.freeze({ ...task, completed }),
    changed: true,
    warnings: validated.warnings,
  });
}

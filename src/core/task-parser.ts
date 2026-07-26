import type { PlanletTask } from "./models.js";
import { PlanletError } from "../errors/planlet-error.js";

const TASK_ID_SOURCE = String.raw`T\d+`;

/** Canonical anchored task-ID shape, reused by completion-record parsing. */
export const TASK_ID_PATTERN = new RegExp(`^${TASK_ID_SOURCE}$`);

const TASK_LINE_PATTERN = new RegExp(
  String.raw`^- \[([ xX])\] (${TASK_ID_SOURCE}) (\S(?:.*?\S)?)[ \t]*$`,
);

/**
 * A bullet with a single-character checkbox marker, e.g. `- [ ]` or `- [x]`.
 * Used to distinguish malformed task lines (missing ID, bad marker, missing
 * space) from ordinary free-form Markdown notes such as `- [see docs] ...`.
 */
const TASK_LIKE_LINE_PATTERN =
  /^(?:- \[[^\]]\]|\s+- \[[ xX]\] T\d+(?:\s|$)|\s*- \[\](?:\s|$))/;

export interface ParsedTasks {
  readonly tasks: readonly PlanletTask[];
  readonly completedCount: number;
  readonly remainingTaskIds: readonly PlanletTask["id"][];
}

export function parseTaskLine(line: string): PlanletTask | null {
  const match = TASK_LINE_PATTERN.exec(line);
  if (match === null) {
    return null;
  }

  const marker = match[1];
  const id = match[2] as PlanletTask["id"] | undefined;
  const description = match[3];
  if (marker === undefined || id === undefined || description === undefined) {
    return null;
  }

  return Object.freeze({
    id,
    description,
    completed: marker.toLowerCase() === "x",
  });
}

export function parseTasks(markdown: string): ParsedTasks {
  const tasks: PlanletTask[] = [];
  const taskIds = new Set<string>();

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const task = parseTaskLine(line);
    if (task === null) {
      if (TASK_LIKE_LINE_PATTERN.test(line)) {
        throw new PlanletError(
          "invalid_plan",
          `Malformed task line at line ${index + 1}`,
          { details: { line: index + 1, content: line } },
        );
      }
      continue;
    }

    if (taskIds.has(task.id)) {
      throw new PlanletError(
        "duplicate_task_id",
        `Duplicate task ID: ${task.id}`,
        { details: { taskId: task.id, line: index + 1 } },
      );
    }

    taskIds.add(task.id);
    tasks.push(task);
  }

  const frozenTasks = Object.freeze(tasks);
  return Object.freeze({
    tasks: frozenTasks,
    completedCount: frozenTasks.filter((task) => task.completed).length,
    remainingTaskIds: Object.freeze(
      frozenTasks.filter((task) => !task.completed).map((task) => task.id),
    ),
  });
}

import type { PlanletTask } from "./models.js";
import { PlanletError } from "../../errors/planlet-error.js";

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
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
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

    let description = task.description;
    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1] ?? "";
      if (parseTaskLine(nextLine) !== null) {
        break;
      }
      if (TASK_LIKE_LINE_PATTERN.test(nextLine)) {
        throw new PlanletError(
          "invalid_plan",
          `Malformed task line at line ${index + 2}`,
          { details: { line: index + 2, content: nextLine } },
        );
      }
      if (/^[ \t]*$/.test(nextLine)) {
        break;
      }
      if (/^[ \t]*(?:#{1,6}\s|>\s)/.test(nextLine)) {
        break;
      }
      if (/^(?: {2}|\t)[ \t]*\S/.test(nextLine)) {
        const trimmed = nextLine.trim();
        description = `${description} ${trimmed}`;
        index += 1;
        continue;
      }
      break;
    }

    const normalizedTask =
      description === task.description
        ? task
        : Object.freeze({ ...task, description });

    if (taskIds.has(normalizedTask.id)) {
      throw new PlanletError(
        "duplicate_task_id",
        `Duplicate task ID: ${normalizedTask.id}`,
        { details: { taskId: normalizedTask.id, line: index + 1 } },
      );
    }

    taskIds.add(normalizedTask.id);
    tasks.push(normalizedTask);
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

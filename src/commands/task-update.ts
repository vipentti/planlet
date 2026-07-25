import {
  updateTask,
  type UpdateTaskDependencies,
  type UpdateTaskResult,
} from "../core/task-update.js";

export interface TaskCommandOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly taskId: string;
  readonly dependencies?: Partial<UpdateTaskDependencies>;
}

export function checkTask(options: TaskCommandOptions): UpdateTaskResult {
  return updateTask({ ...options, operation: "check" });
}

export function uncheckTask(options: TaskCommandOptions): UpdateTaskResult {
  return updateTask({ ...options, operation: "uncheck" });
}

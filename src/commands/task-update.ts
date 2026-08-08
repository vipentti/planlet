import { updateTask } from "../core/plan/task-update.js";
import type { ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";

export interface TaskUpdateCommandArguments {
  readonly operation: "check" | "uncheck";
  readonly slug: string;
  readonly taskId: string;
  readonly stage?: boolean | undefined;
}

export function handleTaskUpdate(
  arguments_: TaskUpdateCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const { warnings, ...result } = updateTask({
      repositoryRoot: context.root,
      ...arguments_,
    });
    return { data: result, warnings };
  }).exitCode;
}

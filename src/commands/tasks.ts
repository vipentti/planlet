import { getPlanletTasks } from "../core/plan/read-only.js";
import type { ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";

export interface TasksCommandArguments {
  readonly slug: string;
  readonly remaining?: boolean | undefined;
  readonly completed?: boolean | undefined;
}

export function handleTasks(
  arguments_: TasksCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const { warnings, ...result } = getPlanletTasks({
      repositoryRoot: context.root,
      ...arguments_,
    });
    return { data: result, warnings };
  }).exitCode;
}

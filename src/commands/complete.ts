import { completePlanlet } from "../core/plan/planlet-completion.js";
import type { ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";

export interface CompleteCommandArguments {
  readonly slug: string;
  readonly allowIncomplete?: boolean | undefined;
  readonly reason?: string | undefined;
}

export function handleComplete(
  arguments_: CompleteCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const result = completePlanlet({
      repositoryRoot: context.root,
      ...arguments_,
      dependencies: { now: context.clock },
    });
    const { warnings, ...summary } = result.summary;
    return {
      data: { ...result, summary },
      warnings,
    };
  }).exitCode;
}

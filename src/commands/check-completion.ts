import { checkCompletion } from "../core/check-completion.js";
import { EXIT_CODES, type ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";

export interface CheckCompletionCommandArguments {
  readonly base: string;
}

export function handleCheckCompletion(
  arguments_: CheckCompletionCommandArguments,
  context: ExecutionContext,
): ExitCode {
  const outcome = emit(context, () => {
    const result = checkCompletion({
      repositoryRoot: context.root,
      base: arguments_.base,
    });
    return {
      data: {
        ok: result.ok,
        base: result.base,
        touched: result.touched,
        completed: result.completed,
        violations: result.violations,
      },
      warnings: result.warnings,
    };
  });
  return outcome.exitCode === EXIT_CODES.success &&
    outcome.data !== undefined &&
    outcome.data.violations.length > 0
    ? EXIT_CODES.stateTransition
    : outcome.exitCode;
}

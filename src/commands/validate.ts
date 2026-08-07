import { validatePlanlets } from "../core/plan/read-only.js";
import { EXIT_CODES, type ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";

export interface ValidateCommandArguments {
  readonly slug?: string | undefined;
  readonly all?: boolean | undefined;
}

export function handleValidate(
  arguments_: ValidateCommandArguments,
  context: ExecutionContext,
): ExitCode {
  const outcome = emit(context, () => {
    const result = validatePlanlets({
      repositoryRoot: context.root,
      ...arguments_,
    });
    return {
      data: result,
      warnings: result.entries.flatMap((entry) => entry.summary.warnings),
    };
  });
  return outcome.exitCode === EXIT_CODES.success &&
    outcome.data?.valid === false
    ? EXIT_CODES.invalidPlan
    : outcome.exitCode;
}

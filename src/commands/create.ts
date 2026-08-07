import { createPlanlet } from "../core/plan/creation.js";
import type { ExitCode } from "../errors/codes.js";
import { compactSummary, emit, type ExecutionContext } from "./shared.js";

export interface CreateCommandArguments {
  readonly slug: string;
  readonly title?: string | undefined;
}

export function handleCreate(
  arguments_: CreateCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const summary = createPlanlet({
      repositoryRoot: context.root,
      ...arguments_,
    });
    return {
      data: { plan: compactSummary(summary) },
      warnings: summary.warnings,
    };
  }).exitCode;
}

import type { PlanletState } from "../core/plan/models.js";
import { listPlanlets } from "../core/plan/read-only.js";
import type { ExitCode } from "../errors/codes.js";
import {
  compactSummary,
  emit,
  warningsFromSummaries,
  type ExecutionContext,
} from "./shared.js";

export interface ListCommandArguments {
  readonly state?: PlanletState | undefined;
  readonly completed?: boolean | undefined;
}

export function handleList(
  arguments_: ListCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const summaries = listPlanlets({
      repositoryRoot: context.root,
      ...arguments_,
    });
    return {
      data: { plans: summaries.map(compactSummary) },
      warnings: warningsFromSummaries(summaries),
    };
  }).exitCode;
}

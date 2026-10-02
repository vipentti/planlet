import { listPlanlets } from "../core/plan/read-only.js";
import { readPlansDir } from "../core/plans-dir.js";
import type { ExitCode } from "../errors/codes.js";
import {
  compactSummary,
  emit,
  warningsFromSummaries,
  type ExecutionContext,
} from "./shared.js";

export function handleDashboard(context: ExecutionContext): ExitCode {
  return emit(context, () => {
    const summaries = listPlanlets({ repositoryRoot: context.root });
    return {
      data: {
        plansDir: readPlansDir(context.root),
        plans: summaries.map(compactSummary),
        summary: {
          active: summaries.length,
          ready: summaries.filter(
            (summary) => summary.state === "ready_to_complete",
          ).length,
          invalid: summaries.filter((summary) => summary.state === "invalid")
            .length,
        },
      },
      warnings: warningsFromSummaries(summaries),
    };
  }).exitCode;
}

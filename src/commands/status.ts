import { getPlanletStatus } from "../core/plan/read-only.js";
import type { ExitCode } from "../errors/codes.js";
import { compactSummary, emit, type ExecutionContext } from "./shared.js";

export function handleStatus(
  arguments_: { readonly slug: string },
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const summary = getPlanletStatus({
      repositoryRoot: context.root,
      slug: arguments_.slug,
    });
    return {
      data: { plan: compactSummary(summary) },
      warnings: summary.warnings,
    };
  }).exitCode;
}

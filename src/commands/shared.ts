import type { PlanSummary } from "../core/plan/models.js";
import type { ExitCode } from "../errors/codes.js";
import { isPlanletError } from "../errors/planlet-error.js";
import { renderToon, renderToonError } from "../output/toon.js";

export interface ExecutionContext {
  readonly root: string;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly clock: () => Date;
  readonly full?: boolean | undefined;
}

export function warningsFromSummaries(
  summaries: readonly PlanSummary[],
): string[] {
  return summaries.flatMap((summary) => summary.warnings);
}

export function compactSummary(
  summary: PlanSummary,
): Readonly<Record<string, unknown>> {
  return {
    slug: summary.slug,
    state: summary.state,
    done: summary.completedTasks,
    total: summary.totalTasks,
  };
}

interface EmitOutcome<T> {
  readonly exitCode: ExitCode;
  readonly data: T | undefined;
}

export function emit<T>(
  context: ExecutionContext,
  operation: () => {
    readonly data: T;
    readonly warnings?: readonly string[];
  },
): EmitOutcome<T> {
  try {
    const outcome = operation();
    const rendered = renderToon(outcome.data, outcome.warnings);
    context.stdout(rendered.stdout);
    if (rendered.stderr.length > 0) context.stderr(rendered.stderr);
    return {
      exitCode: rendered.exitCode,
      data: outcome.data,
    };
  } catch (error) {
    if (!isPlanletError(error)) throw error;
    const rendered = renderToonError(error.toStructuredError());
    if (rendered.stderr.length > 0) context.stderr(rendered.stderr);
    return { exitCode: rendered.exitCode, data: undefined };
  }
}

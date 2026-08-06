import { AGENT_SNIPPET } from "../core/agent-snippet.js";
import { createPlanlet } from "../core/creation.js";
import {
  detectHarnesses,
  installHarnessSkills,
} from "../core/harness-installer.js";
import type { PlanletState, PlanSummary } from "../core/models.js";
import { completePlanlet } from "../core/planlet-completion.js";
import { updateTask } from "../core/task-update.js";
import {
  getPlanletStatus,
  getPlanletTasks,
  listPlanlets,
  showPlanlet,
  validatePlanlets,
  type ShowPart,
} from "../core/read-only.js";
import { EXIT_CODES, type ExitCode } from "../errors/codes.js";
import { isPlanletError } from "../errors/planlet-error.js";
import {
  compactShowContent,
  renderToon,
  renderToonError,
} from "../output/toon.js";

export interface ExecutionContext {
  readonly root: string;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly clock: () => Date;
  readonly full?: boolean | undefined;
}

export interface HarnessCommandArguments {
  readonly tools?: string | undefined;
  readonly force?: boolean | undefined;
  readonly noAgents?: boolean | undefined;
}

export function handleOnboard(context: ExecutionContext): ExitCode {
  context.stdout(`${AGENT_SNIPPET}\n`);
  return EXIT_CODES.success;
}

export interface ListCommandArguments {
  readonly state?: PlanletState | undefined;
  readonly completed?: boolean | undefined;
}

export interface CreateCommandArguments {
  readonly slug: string;
  readonly title?: string | undefined;
}

export interface ShowCommandArguments {
  readonly slug: string;
  readonly part?: ShowPart | undefined;
}

export interface TasksCommandArguments {
  readonly slug: string;
  readonly remaining?: boolean | undefined;
  readonly completed?: boolean | undefined;
}

export interface ValidateCommandArguments {
  readonly slug?: string | undefined;
  readonly all?: boolean | undefined;
}

export interface TaskUpdateCommandArguments {
  readonly operation: "check" | "uncheck";
  readonly slug: string;
  readonly taskId: string;
}

export interface CompleteCommandArguments {
  readonly slug: string;
  readonly allowIncomplete?: boolean | undefined;
  readonly reason?: string | undefined;
}

function warningsFromSummaries(summaries: readonly PlanSummary[]): string[] {
  return summaries.flatMap((summary) => summary.warnings);
}

function compactSummary(
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
  readonly warnings: readonly string[];
}

function emit<T>(
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
      warnings: outcome.warnings ?? [],
    };
  } catch (error) {
    if (!isPlanletError(error)) throw error;
    const rendered = renderToonError(error.toStructuredError());
    if (rendered.stderr.length > 0) context.stderr(rendered.stderr);
    return { exitCode: rendered.exitCode, data: undefined, warnings: [] };
  }
}

export function handleHarnessInit(
  arguments_: HarnessCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () =>
    installHarnessSkills({
      repositoryRoot: context.root,
      operation: "init",
      ...arguments_,
    }),
  ).exitCode;
}

export function handleHarnessUpdate(
  arguments_: HarnessCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () =>
    installHarnessSkills({
      repositoryRoot: context.root,
      operation: "update",
      ...arguments_,
    }),
  ).exitCode;
}

export function handleTools(context: ExecutionContext): ExitCode {
  return emit(context, () => ({
    data: { tools: detectHarnesses({ repositoryRoot: context.root }) },
  })).exitCode;
}

export function handleDashboard(context: ExecutionContext): ExitCode {
  return emit(context, () => {
    const summaries = listPlanlets({ repositoryRoot: context.root });
    return {
      data: {
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

export function handleShow(
  arguments_: ShowCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    // Warnings travel as diagnostics, not as part of the rendered payload.
    const { warnings, ...result } = showPlanlet({
      repositoryRoot: context.root,
      ...arguments_,
    });
    const data =
      context.full !== true && result.content !== undefined
        ? { ...result, content: compactShowContent(result.content) }
        : result;
    return {
      data,
      warnings,
    };
  }).exitCode;
}

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

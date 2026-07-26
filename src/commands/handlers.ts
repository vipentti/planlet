import { createPlanlet } from "../core/creation.js";
import {
  detectHarnesses,
  installHarnessSkills,
} from "../core/harness-installer.js";
import type { PlanletState, PlanSummary } from "../core/models.js";
import { complete } from "./complete.js";
import {
  getPlanletStatus,
  getPlanletTasks,
  listPlanlets,
  showPlanlet,
  validatePlanlets,
  type ShowPart,
} from "./read-only.js";
import { checkTask, uncheckTask } from "./task-update.js";
import { EXIT_CODES, type ExitCode } from "../errors/codes.js";
import { isPlanletError } from "../errors/planlet-error.js";
import { failedResult, successfulResult } from "../output/model.js";
import { renderToon } from "../output/toon.js";

export interface ExecutionContext {
  readonly root: string;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly clock: () => Date;
  readonly full?: boolean;
}

export interface ListCommandArguments {
  readonly state?: PlanletState;
  readonly completed?: boolean;
}

export interface ShowCommandArguments {
  readonly slug: string;
  readonly part?: ShowPart;
}

export interface TasksCommandArguments {
  readonly slug: string;
  readonly remaining?: boolean;
  readonly completed?: boolean;
}

export interface ValidateCommandArguments {
  readonly slug?: string;
  readonly all?: boolean;
}

function warningsFromSummaries(summaries: readonly PlanSummary[]): string[] {
  return summaries.flatMap((summary) => summary.warnings);
}

function compactSummary(
  summary: PlanSummary,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    slug: summary.slug,
    state: summary.state,
    done: summary.completedTasks,
    total: summary.totalTasks,
  });
}

function emit(
  context: ExecutionContext,
  operation: () => {
    readonly data: unknown;
    readonly warnings?: readonly string[];
  },
): ExitCode {
  try {
    const outcome = operation();
    const rendered = renderToon(
      successfulResult(outcome.data, outcome.warnings ?? []),
      context.full === undefined ? {} : { full: context.full },
    );
    context.stdout(rendered.stdout);
    if (rendered.stderr.length > 0) context.stderr(rendered.stderr);
    return rendered.exitCode;
  } catch (error) {
    if (!isPlanletError(error)) throw error;
    const rendered = renderToon(failedResult(error.toStructuredError()));
    if (rendered.stderr.length > 0) context.stderr(rendered.stderr);
    return rendered.exitCode;
  }
}

export function handleHarnessInit(
  arguments_: { readonly tools?: string; readonly force?: boolean },
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => ({
    data: installHarnessSkills({
      repositoryRoot: context.root,
      operation: "init",
      ...(arguments_.tools === undefined ? {} : { tools: arguments_.tools }),
      ...(arguments_.force === undefined ? {} : { force: arguments_.force }),
    }),
  }));
}

export function handleHarnessUpdate(
  arguments_: { readonly tools?: string; readonly force?: boolean },
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => ({
    data: installHarnessSkills({
      repositoryRoot: context.root,
      operation: "update",
      ...(arguments_.tools === undefined ? {} : { tools: arguments_.tools }),
      ...(arguments_.force === undefined ? {} : { force: arguments_.force }),
    }),
  }));
}

export function handleTools(context: ExecutionContext): ExitCode {
  return emit(context, () => ({
    data: { tools: detectHarnesses({ repositoryRoot: context.root }) },
  }));
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
  });
}

export function handleList(
  arguments_: ListCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const summaries = listPlanlets({
      repositoryRoot: context.root,
      ...(arguments_.state === undefined ? {} : { state: arguments_.state }),
      ...(arguments_.completed === undefined
        ? {}
        : { completed: arguments_.completed }),
    });
    return {
      data: { plans: summaries.map(compactSummary) },
      warnings: warningsFromSummaries(summaries),
    };
  });
}

export function handleCreate(
  arguments_: { readonly slug: string; readonly title?: string },
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const summary = createPlanlet({
      repositoryRoot: context.root,
      slug: arguments_.slug,
      ...(arguments_.title === undefined ? {} : { title: arguments_.title }),
    });
    return {
      data: { plan: compactSummary(summary) },
      warnings: summary.warnings,
    };
  });
}

export function handleShow(
  arguments_: ShowCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    // Warnings travel as diagnostics, not as part of the rendered payload.
    const { warnings, ...result } = showPlanlet({
      repositoryRoot: context.root,
      slug: arguments_.slug,
      ...(arguments_.part === undefined ? {} : { part: arguments_.part }),
    });
    return {
      data: result,
      warnings,
    };
  });
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
  });
}

export function handleTasks(
  arguments_: TasksCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const { warnings, ...result } = getPlanletTasks({
      repositoryRoot: context.root,
      slug: arguments_.slug,
      ...(arguments_.remaining === undefined
        ? {}
        : { remaining: arguments_.remaining }),
      ...(arguments_.completed === undefined
        ? {}
        : { completed: arguments_.completed }),
    });
    return { data: result, warnings };
  });
}

export function handleValidate(
  arguments_: ValidateCommandArguments,
  context: ExecutionContext,
): ExitCode {
  let valid = true;
  const exitCode = emit(context, () => {
    const result = validatePlanlets({
      repositoryRoot: context.root,
      ...(arguments_.slug === undefined ? {} : { slug: arguments_.slug }),
      ...(arguments_.all === undefined ? {} : { all: arguments_.all }),
    });
    valid = result.valid;
    return {
      data: result,
      warnings: result.entries.flatMap((entry) => entry.summary.warnings),
    };
  });
  return exitCode === EXIT_CODES.success && !valid
    ? EXIT_CODES.invalidPlan
    : exitCode;
}

export function handleTaskUpdate(
  arguments_: {
    readonly operation: "check" | "uncheck";
    readonly slug: string;
    readonly taskId: string;
  },
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const { warnings, ...result } =
      arguments_.operation === "check"
        ? checkTask({
            repositoryRoot: context.root,
            slug: arguments_.slug,
            taskId: arguments_.taskId,
          })
        : uncheckTask({
            repositoryRoot: context.root,
            slug: arguments_.slug,
            taskId: arguments_.taskId,
          });
    return { data: result, warnings };
  });
}

export function handleComplete(
  arguments_: {
    readonly slug: string;
    readonly allowIncomplete?: boolean;
    readonly reason?: string;
  },
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    const result = complete({
      repositoryRoot: context.root,
      slug: arguments_.slug,
      ...(arguments_.allowIncomplete === undefined
        ? {}
        : { allowIncomplete: arguments_.allowIncomplete }),
      ...(arguments_.reason === undefined ? {} : { reason: arguments_.reason }),
      dependencies: { now: context.clock },
    });
    const { warnings, ...summary } = result.summary;
    return {
      data: { ...result, summary },
      warnings,
    };
  });
}

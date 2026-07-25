import type { CompletionRecord, PlanletState, PlanletTask } from "./models.js";
import { parseCompletionRecord } from "./completion.js";
import { assertValidArchiveName, isValidSlug } from "./slugs.js";
import { deriveLifecycleState, type PlanletLocation } from "./status.js";
import { parseTasks } from "./task-parser.js";
import { PlanletError } from "../errors/planlet-error.js";

export interface PlanletStructureInput {
  readonly directoryName: string;
  readonly location: PlanletLocation;
  readonly planMarkdown: string;
  readonly tasksMarkdown: string;
}

export interface ValidatedPlanletStructure {
  readonly slug: string;
  readonly title: string;
  readonly state: PlanletState;
  readonly tasks: readonly PlanletTask[];
  readonly completion: CompletionRecord | null;
  readonly warnings: readonly string[];
}

function parseInitialH1(markdown: string, filename: string): string {
  const firstLine = markdown.split(/\r?\n/, 1)[0];
  const match =
    firstLine === undefined ? null : /^# (\S(?:.*\S)?)$/.exec(firstLine);
  const title = match?.[1];
  if (title === undefined) {
    throw new PlanletError(
      "invalid_plan",
      `${filename} must begin with a non-empty H1 heading`,
      { details: { filename } },
    );
  }
  return title;
}

function sameTaskIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

export function validatePlanletStructure(
  input: PlanletStructureInput,
): ValidatedPlanletStructure {
  const archive =
    input.location === "completed"
      ? assertValidArchiveName(input.directoryName)
      : null;

  const slug = archive?.slug ?? input.directoryName;
  if (input.location === "active" && !isValidSlug(slug)) {
    throw new PlanletError(
      "invalid_plan",
      `Invalid active planlet slug: ${slug}`,
      {
        details: { slug },
      },
    );
  }

  const title = parseInitialH1(input.planMarkdown, "plan.md");
  parseInitialH1(input.tasksMarkdown, "tasks.md");
  const parsedTasks = parseTasks(input.tasksMarkdown);
  const completion = parseCompletionRecord(input.tasksMarkdown);
  const warnings: string[] = [];

  if (input.location === "active" && completion !== null) {
    warnings.push(
      "Active planlet contains a completion record; complete or archive it to reconcile its lifecycle state",
    );
  }

  if (
    completion?.mode === "incomplete override" &&
    !sameTaskIds(completion.remainingTaskIds, parsedTasks.remainingTaskIds)
  ) {
    throw new PlanletError(
      "invalid_plan",
      "Completion record remaining tasks do not match unchecked tasks",
      {
        details: {
          recorded: completion.remainingTaskIds,
          actual: parsedTasks.remainingTaskIds,
        },
      },
    );
  }

  if (input.location === "completed") {
    if (completion === null || archive === null) {
      throw new PlanletError(
        "invalid_plan",
        "Completed planlet requires a completion record",
        { details: { archiveName: input.directoryName } },
      );
    }

    if (archive.archiveDate !== completion.completedAt.slice(0, 10)) {
      throw new PlanletError(
        "invalid_plan",
        "Archive date does not match the completion timestamp",
        {
          details: {
            archiveDate: archive.archiveDate,
            completedAt: completion.completedAt,
          },
        },
      );
    }

    if (
      completion.mode === "normal" &&
      parsedTasks.remainingTaskIds.length > 0
    ) {
      warnings.push(
        "Completed planlet has unchecked tasks without an override",
      );
    } else if (completion.mode === "incomplete override") {
      warnings.push("Completed planlet contains an incomplete-task override");
    }
  }

  return Object.freeze({
    slug,
    title,
    state: deriveLifecycleState({
      valid: true,
      location: input.location,
      tasks: parsedTasks.tasks,
    }),
    tasks: parsedTasks.tasks,
    completion,
    warnings: Object.freeze(warnings),
  });
}

import type { CompletionRecord, PlanletState, PlanletTask } from "./models.js";
import { parseCompletionRecord } from "./completion.js";
import { assertValidArchiveName, isValidSlug } from "./slugs.js";
import { deriveLifecycleState, type PlanletLocation } from "./status.js";
import { parseTasks } from "./task-parser.js";
import { PlanletError } from "../errors/planlet-error.js";

const RECOMMENDED_PLAN_SECTIONS = Object.freeze([
  "Summary",
  "Scope",
  "Approach",
  "Acceptance Criteria",
  "Verification",
]);

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

/**
 * Cross-checks two independent sources: the IDs recorded in the completion
 * record and the IDs actually left unchecked in tasks.md. Neither derives from
 * the other, so this is not a duplicate of any other check.
 */
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
  const planHeadings = new Set(
    input.planMarkdown.split(/\r?\n/).flatMap((line) => {
      const match = /^## (\S(?:.*\S)?)$/.exec(line);
      return match?.[1] === undefined ? [] : [match[1]];
    }),
  );
  const missingSections = RECOMMENDED_PLAN_SECTIONS.filter(
    (section) => !planHeadings.has(section),
  );
  if (missingSections.length > 0) {
    warnings.push(
      `plan.md is missing recommended sections: ${missingSections.join(", ")}`,
    );
  }

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

    if (parsedTasks.tasks.length === 0) {
      throw new PlanletError(
        "invalid_plan",
        "Completed planlet requires at least one recognized task",
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

  return {
    slug,
    title,
    state: deriveLifecycleState({
      valid: true,
      location: input.location,
      tasks: parsedTasks.tasks,
    }),
    tasks: parsedTasks.tasks,
    completion,
    warnings,
  };
}

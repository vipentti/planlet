export const PLANLET_STATES = [
  "invalid",
  "draft",
  "planned",
  "in_progress",
  "ready_to_complete",
  "completed",
] as const;

export type PlanletState = (typeof PLANLET_STATES)[number];

export interface PlanletTask {
  readonly id: `T${number}`;
  readonly description: string;
  readonly completed: boolean;
}

export interface CompletionRecord {
  readonly completedAt: string;
  readonly mode: "normal" | "incomplete override";
  readonly remainingTaskIds: readonly string[];
  readonly reason?: string;
}

export interface PlanSummary {
  readonly slug: string;
  readonly archiveName?: string;
  readonly completedAt?: string;
  readonly title?: string;
  readonly state: PlanletState;
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly path: string;
  readonly warnings: readonly string[];
}

export type PlanSummaryInput = Omit<PlanSummary, "warnings"> & {
  readonly warnings?: readonly string[];
};

function requireTaskCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function validateStateCounts(
  state: PlanletState,
  completedTasks: number,
  totalTasks: number,
): void {
  if (state === "draft" && totalTasks !== 0) {
    throw new RangeError("draft planlets must have zero tasks");
  }

  if (state === "planned" && (totalTasks === 0 || completedTasks !== 0)) {
    throw new RangeError(
      "planned planlets must have tasks with none completed",
    );
  }

  if (
    state === "in_progress" &&
    (totalTasks === 0 || completedTasks === 0 || completedTasks === totalTasks)
  ) {
    throw new RangeError(
      "in-progress planlets must have some but not all tasks completed",
    );
  }

  if (
    state === "ready_to_complete" &&
    (totalTasks === 0 || completedTasks !== totalTasks)
  ) {
    throw new RangeError(
      "ready-to-complete planlets must have all tasks completed",
    );
  }
}

/**
 * Creates an immutable summary while enforcing the count invariants shared by
 * all status and output consumers.
 *
 * These checks look redundant with the callers that just derived the counts
 * from a task list, but this is the one place every summary is constructed,
 * including from parsed on-disk state and from tests. Keep the guard here
 * rather than trusting each caller. The freeze is asserted by models.test.ts.
 */
export function createPlanSummary(input: PlanSummaryInput): PlanSummary {
  requireTaskCount("completedTasks", input.completedTasks);
  requireTaskCount("totalTasks", input.totalTasks);

  if (input.completedTasks > input.totalTasks) {
    throw new RangeError("completedTasks cannot exceed totalTasks");
  }

  if (input.slug.length === 0 || input.path.length === 0) {
    throw new TypeError("slug and path must be non-empty");
  }

  validateStateCounts(input.state, input.completedTasks, input.totalTasks);

  if (
    input.state === "completed" &&
    (input.archiveName === undefined || input.completedAt === undefined)
  ) {
    throw new TypeError(
      "completed planlets must include archiveName and completedAt",
    );
  }

  const warnings = Object.freeze([...(input.warnings ?? [])]);
  return Object.freeze({ ...input, warnings });
}

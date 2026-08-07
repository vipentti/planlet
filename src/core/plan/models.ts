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

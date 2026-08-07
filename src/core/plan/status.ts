import type { PlanletState, PlanletTask } from "./models.js";

export type PlanletLocation = "active" | "completed";

export interface LifecycleInput {
  readonly valid: boolean;
  readonly location: PlanletLocation;
  readonly tasks: readonly PlanletTask[];
}

export function deriveLifecycleState(input: LifecycleInput): PlanletState {
  if (!input.valid) {
    return "invalid";
  }
  if (input.location === "completed") {
    return "completed";
  }
  if (input.tasks.length === 0) {
    return "draft";
  }

  const completedCount = input.tasks.filter((task) => task.completed).length;
  if (completedCount === 0) {
    return "planned";
  }
  if (completedCount === input.tasks.length) {
    return "ready_to_complete";
  }
  return "in_progress";
}

export const ERROR_CODES = [
  "repo_not_found",
  "plans_not_initialized",
  "invalid_slug",
  "plan_not_found",
  "plan_already_exists",
  "completed_plan_exists",
  "invalid_plan",
  "task_not_found",
  "duplicate_task_id",
  "incomplete_tasks",
  "archive_collision",
  "unsafe_path",
  "write_conflict",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const EXIT_CODES = {
  success: 0,
  operational: 1,
  usage: 2,
  invalidPlan: 3,
  stateTransition: 4,
  filesystemConflict: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const ERROR_EXIT_CODES: Readonly<Record<ErrorCode, ExitCode>> =
  Object.freeze({
    repo_not_found: EXIT_CODES.operational,
    plans_not_initialized: EXIT_CODES.operational,
    invalid_slug: EXIT_CODES.usage,
    plan_not_found: EXIT_CODES.operational,
    plan_already_exists: EXIT_CODES.stateTransition,
    completed_plan_exists: EXIT_CODES.stateTransition,
    invalid_plan: EXIT_CODES.invalidPlan,
    task_not_found: EXIT_CODES.operational,
    duplicate_task_id: EXIT_CODES.invalidPlan,
    incomplete_tasks: EXIT_CODES.stateTransition,
    archive_collision: EXIT_CODES.stateTransition,
    unsafe_path: EXIT_CODES.filesystemConflict,
    write_conflict: EXIT_CODES.filesystemConflict,
  });

export function exitCodeForError(code: ErrorCode): ExitCode {
  return ERROR_EXIT_CODES[code];
}

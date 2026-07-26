import type { CompletionRecord, PlanletTask } from "./models.js";
import { TASK_ID_PATTERN } from "./task-parser.js";
import { PlanletError } from "../errors/planlet-error.js";

// Match the completion heading tolerantly (case, surrounding whitespace) so a
// near-miss like `## completion` surfaces a parse error instead of silently
// being treated as if no completion record existed.
const COMPLETION_HEADING_PATTERN = /^##[ \t]+completion[ \t]*$/i;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function invalidCompletion(message: string): never {
  throw new PlanletError("invalid_plan", message, {
    details: { section: "Completion" },
  });
}

export function isValidUtcTimestamp(value: string): boolean {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) {
    return false;
  }

  const normalized = instant.toISOString();
  return value.includes(".")
    ? normalized === value
    : normalized.replace(".000Z", "Z") === value;
}

function parseRemainingTaskIds(value: string): readonly PlanletTask["id"][] {
  const ids = value.split(",").map((item) => item.trim());
  if (
    ids.some((id) => !TASK_ID_PATTERN.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    invalidCompletion("Completion record has invalid remaining task IDs");
  }

  return Object.freeze(ids as PlanletTask["id"][]);
}

export function parseCompletionRecord(
  markdown: string,
): CompletionRecord | null {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.flatMap((line, index) =>
    COMPLETION_HEADING_PATTERN.test(line) ? [index] : [],
  );

  if (headings.length === 0) {
    return null;
  }
  if (headings.length !== 1) {
    invalidCompletion("Tasks file contains multiple completion records");
  }

  const headingIndex = headings[0];
  if (headingIndex === undefined) {
    return null;
  }

  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || /^##\s/.test(line)) {
      break;
    }
    if (line.length > 0) {
      sectionLines.push(line);
    }
  }

  const fields = new Map<string, string>();
  for (const line of sectionLines) {
    const match = /^- (Completed at|Mode|Remaining tasks|Reason): (.+)$/.exec(
      line,
    );
    if (match === null) {
      invalidCompletion("Completion record contains an invalid field");
    }

    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined || fields.has(name)) {
      invalidCompletion("Completion record contains a duplicate field");
    }
    fields.set(name, value);
  }

  const completedAt = fields.get("Completed at");
  const mode = fields.get("Mode");
  if (completedAt === undefined || !isValidUtcTimestamp(completedAt)) {
    invalidCompletion("Completion record has an invalid UTC timestamp");
  }
  if (mode !== "normal" && mode !== "incomplete override") {
    invalidCompletion("Completion record has an invalid mode");
  }

  const remaining = fields.get("Remaining tasks");
  const reason = fields.get("Reason");
  if (mode === "normal") {
    if (remaining !== undefined || reason !== undefined) {
      invalidCompletion("Normal completion record has unexpected fields");
    }
    return Object.freeze({
      completedAt,
      mode,
      remainingTaskIds: Object.freeze([]),
    });
  }

  if (
    remaining === undefined ||
    reason === undefined ||
    reason.trim().length === 0
  ) {
    invalidCompletion(
      "Incomplete override requires remaining tasks and a non-empty reason",
    );
  }

  return Object.freeze({
    completedAt,
    mode,
    remainingTaskIds: parseRemainingTaskIds(remaining),
    reason,
  });
}

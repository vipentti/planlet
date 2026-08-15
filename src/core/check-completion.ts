import { listDiffPaths } from "./git.js";
import {
  listPlanlets,
  validatePlanlets,
  type ValidationResult,
} from "./plan/read-only.js";
import type { PlanSummary } from "./plan/models.js";
import { isValidSlug } from "./plan/slugs.js";
import { byName } from "./paths.js";

export interface CompletionViolation {
  readonly slug: string;
  readonly next: `planlet complete ${string}`;
}

interface CheckCompletionReport {
  readonly ok: boolean;
  readonly base: string;
  readonly touched: readonly string[];
  readonly violations: readonly CompletionViolation[];
}

export interface CheckCompletionOptions {
  readonly repositoryRoot: string;
  readonly base: string;
}

/** Extracts valid active-planlet slug segments from repository-relative paths. */
export function extractTouchedSlugs(
  paths: readonly string[],
): readonly string[] {
  const slugs = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    const slug = segments[1];
    if (
      segments.length < 3 ||
      segments[0] !== "plans" ||
      slug === undefined ||
      slug === "completed" ||
      !isValidSlug(slug)
    ) {
      continue;
    }
    slugs.add(slug);
  }
  return [...slugs].sort(byName);
}

/**
 * Selects only unique active planlets whose canonical state is ready to
 * complete. Validation entries with a logical-slug conflict are invalid and
 * therefore cannot produce a recommendation.
 */
export function selectCompletionViolations(
  touchedSlugs: readonly string[],
  activePlanlets: readonly PlanSummary[],
  validation: ValidationResult,
): readonly CompletionViolation[] {
  const activeBySlug = new Map(
    activePlanlets.map((summary) => [summary.slug, summary]),
  );
  const uniqueReadyPaths = new Set(
    validation.entries
      .filter((entry) => {
        const active = activeBySlug.get(entry.slug);
        return (
          entry.valid &&
          entry.summary.state === "ready_to_complete" &&
          active?.path === entry.path
        );
      })
      .map((entry) => entry.path),
  );

  return touchedSlugs.flatMap((slug) => {
    const active = activeBySlug.get(slug);
    return active !== undefined && uniqueReadyPaths.has(active.path)
      ? [{ slug, next: `planlet complete ${slug}` as const }]
      : [];
  });
}

export interface CheckCompletionResult extends CheckCompletionReport {
  readonly warnings: readonly string[];
}

export function checkCompletion(
  options: CheckCompletionOptions,
): CheckCompletionResult {
  const changedPaths = listDiffPaths(options.repositoryRoot, {
    base: options.base,
    pathspec: "plans/",
  });
  const touchedCandidates = extractTouchedSlugs(changedPaths);
  const activePlanlets = listPlanlets({
    repositoryRoot: options.repositoryRoot,
  });
  const activeBySlug = new Map(
    activePlanlets.map((summary) => [summary.slug, summary]),
  );
  const touched = touchedCandidates.filter((slug) => activeBySlug.has(slug));
  const validation = validatePlanlets({
    repositoryRoot: options.repositoryRoot,
    all: true,
  });
  const violations = selectCompletionViolations(
    touched,
    activePlanlets,
    validation,
  );

  return {
    ok: violations.length === 0,
    base: options.base,
    touched,
    violations,
    warnings: activePlanlets.flatMap((summary) => summary.warnings),
  };
}

import { listDiffPaths } from "./git.js";
import { validatePlanlets, type ValidationResult } from "./plan/read-only.js";
import { isValidSlug } from "./plan/slugs.js";
import { byName } from "./paths.js";

interface CompletionViolation {
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

export interface CheckCompletionResult extends CheckCompletionReport {
  readonly warnings: readonly string[];
}

/** Derives the check report from one canonical validation snapshot. */
export function deriveCompletionResult(
  base: string,
  touchedCandidates: readonly string[],
  validation: ValidationResult,
): CheckCompletionResult {
  const activeEntries = validation.entries.filter(
    (entry) => entry.summary.archiveName === undefined,
  );
  const activeBySlug = new Map(
    activeEntries.map((entry) => [entry.slug, entry]),
  );
  const touched = touchedCandidates.filter((slug) => activeBySlug.has(slug));
  const violations = touched.flatMap((slug) => {
    const entry = activeBySlug.get(slug);
    return entry?.valid && entry.summary.state === "ready_to_complete"
      ? [{ slug, next: `planlet complete ${slug}` as const }]
      : [];
  });

  return {
    ok: violations.length === 0,
    base,
    touched,
    violations,
    warnings: activeEntries.flatMap((entry) => entry.summary.warnings),
  };
}

export function checkCompletion(
  options: CheckCompletionOptions,
): CheckCompletionResult {
  const changedPaths = listDiffPaths(options.repositoryRoot, {
    base: options.base,
    pathspec: "plans/",
  });
  const validation = validatePlanlets({
    repositoryRoot: options.repositoryRoot,
    all: true,
  });
  return deriveCompletionResult(
    options.base,
    extractTouchedSlugs(changedPaths),
    validation,
  );
}

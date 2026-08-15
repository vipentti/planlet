import { listDiffChanges, type GitDiffChange } from "./git.js";
import { validatePlanlets, type ValidationResult } from "./plan/read-only.js";
import { isValidSlug, parseArchiveName } from "./plan/slugs.js";
import { byName } from "./paths.js";

interface CompletionViolation {
  readonly slug: string;
  readonly next: `planlet complete ${string}`;
}

interface CheckCompletionReport {
  readonly ok: boolean;
  readonly base: string;
  readonly touched: readonly string[];
  readonly completed: readonly string[];
  readonly violations: readonly CompletionViolation[];
}

export interface CheckCompletionOptions {
  readonly repositoryRoot: string;
  readonly base: string;
}

function extractActiveSlug(path: string): string | undefined {
  const segments = path.split("/");
  const slug = segments[1];
  if (
    segments.length < 3 ||
    segments[0] !== "plans" ||
    slug === undefined ||
    slug === "completed" ||
    !isValidSlug(slug)
  ) {
    return undefined;
  }
  return slug;
}

/** Extracts valid active-planlet slug segments from repository-relative paths. */
export function extractTouchedSlugs(
  paths: readonly string[],
): readonly string[] {
  const slugs = new Set<string>();
  for (const path of paths) {
    const slug = extractActiveSlug(path);
    if (slug !== undefined) slugs.add(slug);
  }
  return [...slugs].sort(byName);
}

function extractArchivedSlug(path: string): string | undefined {
  const segments = path.split("/");
  const archiveName = segments[2];
  if (
    segments.length < 4 ||
    segments[0] !== "plans" ||
    segments[1] !== "completed" ||
    archiveName === undefined
  ) {
    return undefined;
  }
  return parseArchiveName(archiveName)?.slug;
}

/** Extracts slugs whose active path was removed and archive path was added. */
export function extractCompletedSlugs(
  changes: readonly GitDiffChange[],
): readonly string[] {
  const removed = new Set<string>();
  const archived = new Set<string>();
  for (const change of changes) {
    const kind = change.status[0];
    const source = change.paths[0];
    const destination = change.paths[1] ?? source;
    if ((kind === "D" || kind === "R") && source !== undefined) {
      const slug = extractActiveSlug(source);
      if (slug !== undefined) removed.add(slug);
    }
    if ((kind === "A" || kind === "R") && destination !== undefined) {
      const slug = extractArchivedSlug(destination);
      if (slug !== undefined) archived.add(slug);
    }
  }

  return [...removed].filter((slug) => archived.has(slug)).sort(byName);
}

export interface CheckCompletionResult extends CheckCompletionReport {
  readonly warnings: readonly string[];
}

/** Derives the check report from one canonical validation snapshot. */
export function deriveCompletionResult(
  base: string,
  touchedCandidates: readonly string[],
  validation: ValidationResult,
  completedCandidates: readonly string[] = [],
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
    completed: [...new Set(completedCandidates)].sort(byName),
    violations,
    warnings: activeEntries.flatMap((entry) => entry.summary.warnings),
  };
}

export function checkCompletion(
  options: CheckCompletionOptions,
): CheckCompletionResult {
  const changes = listDiffChanges(options.repositoryRoot, {
    base: options.base,
    pathspec: "plans/",
  });
  const validation = validatePlanlets({
    repositoryRoot: options.repositoryRoot,
    all: true,
  });
  return deriveCompletionResult(
    options.base,
    extractTouchedSlugs(changes.flatMap((change) => change.paths)),
    validation,
    extractCompletedSlugs(changes),
  );
}

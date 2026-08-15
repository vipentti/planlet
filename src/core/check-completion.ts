import { listDiffPaths } from "./git.js";
import { validatePlanlets, type ValidationResult } from "./plan/read-only.js";
import {
  isValidSlug,
  parseArchiveName,
  type ParsedArchiveName,
} from "./plan/slugs.js";
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

function extractArchivedPath(path: string): ParsedArchiveName | undefined {
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
  return parseArchiveName(archiveName) ?? undefined;
}

export interface CompletedPathCandidate {
  readonly slug: string;
  readonly archiveName: string;
}

/** Extracts active/archive path pairs changed in the Git range. */
export function extractCompletedSlugs(
  paths: readonly string[],
): readonly CompletedPathCandidate[] {
  const activeSlugs = new Set<string>();
  const archiveNamesBySlug = new Map<string, Set<string>>();
  for (const path of paths) {
    const activeSlug = extractActiveSlug(path);
    if (activeSlug !== undefined) activeSlugs.add(activeSlug);

    const archive = extractArchivedPath(path);
    if (archive === undefined) continue;
    const archiveNames = archiveNamesBySlug.get(archive.slug) ?? new Set();
    archiveNames.add(archive.archiveName);
    archiveNamesBySlug.set(archive.slug, archiveNames);
  }

  return [...activeSlugs]
    .flatMap((slug) =>
      [...(archiveNamesBySlug.get(slug) ?? [])].map((archiveName) => ({
        slug,
        archiveName,
      })),
    )
    .sort(
      (left, right) =>
        byName(left.slug, right.slug) ||
        byName(left.archiveName, right.archiveName),
    );
}

export interface CheckCompletionResult extends CheckCompletionReport {
  readonly warnings: readonly string[];
}

/** Derives the check report from one canonical validation snapshot. */
export function deriveCompletionResult(
  base: string,
  touchedCandidates: readonly string[],
  validation: ValidationResult,
  completedCandidates: readonly CompletedPathCandidate[] = [],
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
  const completed = [
    ...new Set(
      completedCandidates
        .filter((candidate) => !activeBySlug.has(candidate.slug))
        .filter((candidate) =>
          validation.entries.some(
            (entry) =>
              entry.valid &&
              entry.slug === candidate.slug &&
              entry.summary.state === "completed" &&
              entry.summary.archiveName === candidate.archiveName,
          ),
        )
        .map((candidate) => candidate.slug),
    ),
  ].sort(byName);

  return {
    ok: violations.length === 0,
    base,
    touched,
    completed,
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
    extractCompletedSlugs(changedPaths),
  );
}

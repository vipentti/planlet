import { isPlanletError } from "../errors/planlet-error.js";
import { listDiffPaths } from "./git.js";
import { validatePlanlets, type ValidationResult } from "./plan/read-only.js";
import {
  isValidSlug,
  parseArchiveName,
  type ParsedArchiveName,
} from "./plan/slugs.js";
import { byName } from "./paths.js";
import {
  DEFAULT_PLANS_DIR,
  plansDirPathspec,
  readPlansDir,
} from "./plans-dir.js";

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

function remainingAfterPlansDir(
  path: string,
  plansDir: string,
): readonly string[] | undefined {
  const prefix = plansDir.split("/");
  const segments = path.split("/");
  if (segments.length <= prefix.length) {
    return undefined;
  }
  for (let index = 0; index < prefix.length; index += 1) {
    if (segments[index] !== prefix[index]) {
      return undefined;
    }
  }
  return segments.slice(prefix.length);
}

function extractActiveSlug(path: string, plansDir: string): string | undefined {
  const rest = remainingAfterPlansDir(path, plansDir);
  const slug = rest?.[0];
  if (
    rest === undefined ||
    rest.length < 2 ||
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
  plansDir = DEFAULT_PLANS_DIR,
): readonly string[] {
  const slugs = new Set<string>();
  for (const path of paths) {
    const slug = extractActiveSlug(path, plansDir);
    if (slug !== undefined) slugs.add(slug);
  }
  return [...slugs].sort(byName);
}

function extractArchivedPath(
  path: string,
  plansDir: string,
): ParsedArchiveName | undefined {
  const rest = remainingAfterPlansDir(path, plansDir);
  const archiveName = rest?.[1];
  if (
    rest === undefined ||
    rest.length < 3 ||
    rest[0] !== "completed" ||
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
  plansDir = DEFAULT_PLANS_DIR,
): readonly CompletedPathCandidate[] {
  const activeSlugs = new Set<string>();
  const archiveNamesBySlug = new Map<string, Set<string>>();
  for (const path of paths) {
    const activeSlug = extractActiveSlug(path, plansDir);
    if (activeSlug !== undefined) activeSlugs.add(activeSlug);

    const archive = extractArchivedPath(path, plansDir);
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
  const plansDir = readPlansDir(options.repositoryRoot);
  const changedPaths = listDiffPaths(options.repositoryRoot, {
    base: options.base,
    pathspec: plansDirPathspec(plansDir),
  });
  let validation: ValidationResult;
  try {
    validation = validatePlanlets({
      repositoryRoot: options.repositoryRoot,
      all: true,
    });
  } catch (error) {
    if (isPlanletError(error) && error.code === "plans_not_initialized") {
      return {
        ok: true,
        base: options.base,
        touched: [],
        completed: [],
        violations: [],
        warnings: [],
      };
    }
    throw error;
  }
  return deriveCompletionResult(
    options.base,
    extractTouchedSlugs(changedPaths, plansDir),
    validation,
    extractCompletedSlugs(changedPaths, plansDir),
  );
}

import {
  lstatSync,
  readFileSync,
  readdirSync,
  type Dirent,
  type Stats,
} from "node:fs";
import { resolve } from "node:path";

import {
  createPlanSummary,
  PLANLET_STATES,
  type PlanletState,
  type PlanletTask,
  type PlanSummary,
} from "../core/models.js";
import { resolveSafePath } from "../core/paths.js";
import {
  assertValidSlug,
  isValidSlug,
  parseArchiveName,
} from "../core/slugs.js";
import type { PlanletLocation } from "../core/status.js";
import {
  validatePlanletStructure,
  type ValidatedPlanletStructure,
} from "../core/validation.js";
import type { StructuredError } from "../errors/planlet-error.js";
import { isPlanletError, PlanletError } from "../errors/planlet-error.js";

export type ShowPart = "plan" | "tasks" | "summary";

export interface ListPlanletsOptions {
  readonly repositoryRoot: string;
  readonly state?: PlanletState;
  /** Include completed planlets in addition to active planlets. */
  readonly completed?: boolean;
}

export interface ShowPlanletOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly part?: ShowPart;
}

export interface ShowPlanletResult {
  readonly slug: string;
  readonly part: ShowPart;
  readonly summary?: PlanSummary;
  readonly content?: string;
  /** Advisory warnings from the single load backing this result. */
  readonly warnings: readonly string[];
}

export interface TasksOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly remaining?: boolean;
  readonly completed?: boolean;
}

export interface TasksResult {
  readonly slug: string;
  readonly tasks: readonly PlanletTask[];
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly warnings: readonly string[];
}

export interface ValidatePlanletsOptions {
  readonly repositoryRoot: string;
  readonly slug?: string;
  /** Validate active and completed storage. Without --all, validate active storage. */
  readonly all?: boolean;
}

export interface ValidationEntry {
  readonly slug: string;
  readonly path: string;
  readonly valid: boolean;
  readonly summary: PlanSummary;
  readonly error?: StructuredError;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly checked: number;
  readonly entries: readonly ValidationEntry[];
}

interface PlanletCandidate {
  readonly directoryName: string;
  readonly location: PlanletLocation;
  readonly storageRoot: string;
  readonly path: string;
}

interface LoadedPlanlet {
  readonly candidate: PlanletCandidate;
  readonly planMarkdown: string;
  readonly tasksMarkdown: string;
  readonly validated: ValidatedPlanletStructure;
  readonly summary: PlanSummary;
}

function tryLstat(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function plansPath(repositoryRoot: string): string {
  const path = resolveSafePath(repositoryRoot, "plans");
  if (!tryLstat(path)?.isDirectory()) {
    throw new PlanletError(
      "plans_not_initialized",
      "Repository does not contain a plans directory",
      { details: { path } },
    );
  }
  return path;
}

function directoryEntries(path: string): readonly Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
  } catch (error) {
    throw new PlanletError("invalid_plan", "Cannot read planlet directory", {
      details: { path },
      cause: error,
    });
  }
}

function makeCandidate(
  parent: string,
  directoryName: string,
  location: PlanletLocation,
): PlanletCandidate {
  return {
    directoryName,
    location,
    storageRoot: parent,
    // Preserve lexical entry. Resolving here lets one unsafe symlink abort
    // discovery before commands can report that entry as invalid.
    path: resolve(parent, directoryName),
  };
}

function discoverCandidates(
  repositoryRoot: string,
  includeCompleted: boolean,
): readonly PlanletCandidate[] {
  const root = plansPath(repositoryRoot);
  const candidates: PlanletCandidate[] = [];

  for (const entry of directoryEntries(root)) {
    if (entry.name === "completed" || entry.name.startsWith(".")) {
      continue;
    }
    candidates.push(makeCandidate(root, entry.name, "active"));
  }

  if (!includeCompleted) {
    return candidates;
  }

  const completedRoot = resolveSafePath(root, "completed");
  const completedStats = tryLstat(completedRoot);
  if (completedStats === null) {
    return candidates;
  }
  if (!completedStats.isDirectory()) {
    throw new PlanletError(
      "invalid_plan",
      "Completed planlet storage is not a directory",
      { details: { path: completedRoot } },
    );
  }

  for (const entry of directoryEntries(completedRoot)) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    candidates.push(makeCandidate(completedRoot, entry.name, "completed"));
  }

  return candidates;
}

function readMarkdown(candidate: PlanletCandidate, filename: string): string {
  const path = resolveSafePath(
    candidate.storageRoot,
    candidate.directoryName,
    filename,
  );
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new PlanletError("invalid_plan", `Cannot read ${filename}`, {
      details: { path, directoryName: candidate.directoryName },
      cause: error,
    });
  }
}

function summaryFromValidated(
  candidate: PlanletCandidate,
  validated: ValidatedPlanletStructure,
): PlanSummary {
  const completedTasks = validated.tasks.filter(
    (task) => task.completed,
  ).length;
  const archiveName =
    candidate.location === "completed" ? candidate.directoryName : undefined;
  const completedAt = validated.completion?.completedAt;

  return createPlanSummary({
    slug: validated.slug,
    ...(archiveName === undefined ? {} : { archiveName }),
    ...(completedAt === undefined ? {} : { completedAt }),
    title: validated.title,
    state: validated.state,
    completedTasks,
    totalTasks: validated.tasks.length,
    path: candidate.path,
    warnings: validated.warnings,
  });
}

function loadCandidate(candidate: PlanletCandidate): LoadedPlanlet {
  const planMarkdown = readMarkdown(candidate, "plan.md");
  const tasksMarkdown = readMarkdown(candidate, "tasks.md");
  const validated = validatePlanletStructure({
    directoryName: candidate.directoryName,
    location: candidate.location,
    planMarkdown,
    tasksMarkdown,
  });
  return {
    candidate,
    planMarkdown,
    tasksMarkdown,
    validated,
    summary: summaryFromValidated(candidate, validated),
  };
}

function invalidSummary(candidate: PlanletCandidate): PlanSummary {
  const parsedArchive =
    candidate.location === "completed"
      ? parseArchiveName(candidate.directoryName)
      : null;
  return createPlanSummary({
    slug: parsedArchive?.slug ?? candidate.directoryName,
    ...(candidate.location === "completed"
      ? { archiveName: candidate.directoryName }
      : {}),
    state: "invalid",
    completedTasks: 0,
    totalTasks: 0,
    path: candidate.path,
    warnings: [],
  });
}

function findCandidate(repositoryRoot: string, slug: string): PlanletCandidate {
  assertValidSlug(slug);
  const root = plansPath(repositoryRoot);
  const matches: PlanletCandidate[] = [];

  // Filter names before resolving candidate paths. Unrelated unsafe entries
  // must not block a targeted lookup.
  if (directoryEntries(root).some((entry) => entry.name === slug)) {
    matches.push(makeCandidate(root, slug, "active"));
  }

  const completedRoot = resolveSafePath(root, "completed");
  const completedStats = tryLstat(completedRoot);
  if (completedStats !== null) {
    if (!completedStats.isDirectory()) {
      throw new PlanletError(
        "invalid_plan",
        "Completed planlet storage is not a directory",
        { details: { path: completedRoot } },
      );
    }
    for (const entry of directoryEntries(completedRoot)) {
      if (parseArchiveName(entry.name)?.slug === slug) {
        matches.push(makeCandidate(completedRoot, entry.name, "completed"));
      }
    }
  }

  if (matches.length === 0) {
    throw new PlanletError("plan_not_found", `Planlet not found: ${slug}`, {
      details: { slug },
    });
  }
  if (matches.length > 1) {
    throw new PlanletError(
      "invalid_plan",
      `Planlet logical slug is not unique: ${slug}`,
      {
        details: {
          slug,
          paths: matches.map((candidate) => candidate.path),
        },
      },
    );
  }

  const candidate = matches[0];
  if (candidate === undefined) {
    throw new PlanletError("plan_not_found", `Planlet not found: ${slug}`);
  }
  return candidate;
}

export function listPlanlets(
  options: ListPlanletsOptions,
): readonly PlanSummary[] {
  if (options.state !== undefined && !PLANLET_STATES.includes(options.state)) {
    throw new TypeError(`Unknown planlet state: ${options.state}`);
  }

  return Object.freeze(
    discoverCandidates(options.repositoryRoot, options.completed === true)
      .map((candidate) => {
        try {
          return loadCandidate(candidate).summary;
        } catch (error) {
          if (isPlanletError(error)) {
            return invalidSummary(candidate);
          }
          throw error;
        }
      })
      .filter(
        (summary) =>
          options.state === undefined || summary.state === options.state,
      ),
  );
}

export function showPlanlet(options: ShowPlanletOptions): ShowPlanletResult {
  const loaded = loadCandidate(
    findCandidate(options.repositoryRoot, options.slug),
  );
  const part = options.part ?? "summary";

  if (part === "summary") {
    return Object.freeze({
      slug: loaded.summary.slug,
      part,
      summary: loaded.summary,
      warnings: loaded.summary.warnings,
    });
  }
  if (part === "plan") {
    return Object.freeze({
      slug: loaded.summary.slug,
      part,
      content: loaded.planMarkdown,
      warnings: loaded.summary.warnings,
    });
  }
  if (part === "tasks") {
    return Object.freeze({
      slug: loaded.summary.slug,
      part,
      content: loaded.tasksMarkdown,
      warnings: loaded.summary.warnings,
    });
  }
  throw new TypeError(`Unknown show part: ${String(part)}`);
}

export function getPlanletStatus(
  options: Pick<ShowPlanletOptions, "repositoryRoot" | "slug">,
): PlanSummary {
  return loadCandidate(findCandidate(options.repositoryRoot, options.slug))
    .summary;
}

export function getPlanletTasks(options: TasksOptions): TasksResult {
  if (options.remaining === true && options.completed === true) {
    throw new TypeError(
      "remaining and completed task filters are mutually exclusive",
    );
  }

  const loaded = loadCandidate(
    findCandidate(options.repositoryRoot, options.slug),
  );
  const tasks = loaded.validated.tasks.filter((task) =>
    options.remaining === true
      ? !task.completed
      : options.completed === true
        ? task.completed
        : true,
  );

  return Object.freeze({
    slug: loaded.summary.slug,
    tasks: Object.freeze(tasks),
    completedTasks: loaded.summary.completedTasks,
    totalTasks: loaded.summary.totalTasks,
    warnings: loaded.summary.warnings,
  });
}

function validationEntry(candidate: PlanletCandidate): ValidationEntry {
  try {
    const loaded = loadCandidate(candidate);
    return Object.freeze({
      slug: loaded.summary.slug,
      path: candidate.path,
      valid: true,
      summary: loaded.summary,
    });
  } catch (error) {
    if (!isPlanletError(error)) {
      throw error;
    }
    const summary = invalidSummary(candidate);
    return Object.freeze({
      slug: summary.slug,
      path: candidate.path,
      valid: false,
      summary,
      error: error.toStructuredError(),
    });
  }
}

export function validatePlanlets(
  options: ValidatePlanletsOptions,
): ValidationResult {
  if (options.slug !== undefined && options.all === true) {
    throw new TypeError(
      "slug and all validation targets are mutually exclusive",
    );
  }

  const candidates =
    options.slug === undefined
      ? discoverCandidates(options.repositoryRoot, options.all === true)
      : [findCandidate(options.repositoryRoot, options.slug)];
  const candidatesBySlug = new Map<string, PlanletCandidate[]>();
  for (const candidate of candidates) {
    const slug =
      candidate.location === "active"
        ? isValidSlug(candidate.directoryName)
          ? candidate.directoryName
          : null
        : parseArchiveName(candidate.directoryName)?.slug;
    if (slug !== null && slug !== undefined) {
      const matches = candidatesBySlug.get(slug) ?? [];
      matches.push(candidate);
      candidatesBySlug.set(slug, matches);
    }
  }

  const entries = Object.freeze(
    candidates.map((candidate) => {
      const entry = validationEntry(candidate);
      const conflicts = candidatesBySlug.get(entry.slug);
      if (conflicts === undefined || conflicts.length < 2) {
        return entry;
      }

      const summary = invalidSummary(candidate);
      const error = new PlanletError(
        "invalid_plan",
        `Planlet logical slug is not unique: ${entry.slug}`,
        {
          details: {
            slug: entry.slug,
            paths: conflicts.map((conflict) => conflict.path),
          },
        },
      );
      return Object.freeze({
        slug: entry.slug,
        path: candidate.path,
        valid: false,
        summary,
        error: error.toStructuredError(),
      });
    }),
  );
  return Object.freeze({
    valid: entries.every((entry) => entry.valid),
    checked: entries.length,
    entries,
  });
}

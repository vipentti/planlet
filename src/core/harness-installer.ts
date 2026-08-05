import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  PlanletError,
  asWriteConflict,
  isPlanletError,
} from "../errors/planlet-error.js";
import {
  HARNESS_ADAPTERS,
  normalizeToolSelector,
  resolveHarnessDestinations,
  type HarnessDestination,
  type HarnessToolId,
} from "./harnesses.js";
import { byName, resolveSafePath, tryLstat } from "./paths.js";
import { withHarnessInstallLock } from "./planlet-lock.js";
import type { PlanletLockDependencies } from "./planlet-lock.js";
import {
  enumerateCanonicalSkills,
  sha256,
  type CanonicalSkillSource,
} from "./skill-source.js";

export const INSTALLATION_MANIFEST = ".planlet-manifest.json";
const INSTALLATION_MANIFEST_VERSION = 2;

export interface InstallationManifest {
  readonly schemaVersion: typeof INSTALLATION_MANIFEST_VERSION;
  readonly files: Readonly<Record<string, string>>;
}

type HarnessState = "missing" | "unmanaged" | "installed" | "modified";

interface HarnessInstallationSummary {
  readonly destination: string;
  readonly tools: readonly HarnessToolId[];
  readonly state: HarnessState;
  readonly changed: boolean;
  readonly files: number;
}

interface InstallationSummary {
  readonly operation: "init" | "update";
  readonly changed: boolean;
  readonly plansInitialized: boolean;
  readonly destinations: readonly HarnessInstallationSummary[];
}

/** Summary for stdout plus diagnostics for stderr, never mixed into the data. */
export interface InstallationOutcome {
  readonly data: InstallationSummary;
  readonly warnings: readonly string[];
}

export interface DetectedHarness {
  readonly id: HarnessToolId;
  readonly name: string;
  readonly destination: string;
  readonly state: HarnessState;
}

interface DestinationInspection {
  readonly destination: HarnessDestination;
  readonly state: HarnessState;
  readonly actualFiles: Readonly<Record<string, string>>;
  readonly desiredManifestText: string;
  readonly conflicts: readonly string[];
  readonly publishSkills: boolean;
  readonly writeManifest: boolean;
}

function pathKind(path: string): "missing" | "directory" | "file" | "symlink" {
  const stats = tryLstat(path);
  if (stats === null) return "missing";
  if (stats.isSymbolicLink()) return "symlink";
  return stats.isDirectory() ? "directory" : "file";
}

function sortedRecord(
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => byName(left, right)),
  );
}

export function createInstallationManifest(
  source: CanonicalSkillSource,
): InstallationManifest {
  return {
    schemaVersion: INSTALLATION_MANIFEST_VERSION,
    files: sortedRecord(
      source.files.map((file) => [file.relativePath, file.digest] as const),
    ),
  };
}

export function serializeInstallationManifest(
  manifest: InstallationManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export function parseInstallationManifest(
  content: string,
  path = INSTALLATION_MANIFEST,
): InstallationManifest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new PlanletError(
      "write_conflict",
      `Invalid installation manifest: ${path}`,
      {
        details: { path },
        cause: error,
      },
    );
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlanletError(
      "write_conflict",
      `Invalid installation manifest: ${path}`,
      {
        details: { path },
      },
    );
  }
  const candidate = value as Record<string, unknown>;
  const files = candidate.files;
  if (
    candidate.schemaVersion !== INSTALLATION_MANIFEST_VERSION ||
    candidate.tools !== undefined ||
    !isStringRecord(files)
  ) {
    throw new PlanletError(
      "write_conflict",
      `Invalid installation manifest: ${path}`,
      {
        details: { path, schemaVersion: candidate.schemaVersion },
      },
    );
  }

  return {
    schemaVersion: INSTALLATION_MANIFEST_VERSION,
    files: sortedRecord(Object.entries(files)),
  };
}

function collectPlanletFiles(
  destinationPath: string,
): Readonly<Record<string, string>> {
  if (pathKind(destinationPath) === "missing") return {};
  if (pathKind(destinationPath) !== "directory") {
    throw new PlanletError(
      "write_conflict",
      `Harness destination is not a directory: ${destinationPath}`,
      { details: { path: destinationPath } },
    );
  }

  const entries: Array<readonly [string, string]> = [];
  const visit = (directory: string, relativeDirectory: string): void => {
    const children = readdirSync(directory, { withFileTypes: true }).sort(
      (left: Dirent, right: Dirent) => byName(left.name, right.name),
    );
    for (const child of children) {
      const path = join(directory, child.name);
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name;
      const kind = pathKind(path);
      if (kind === "symlink") {
        throw new PlanletError(
          "unsafe_path",
          `Harness installation contains a symbolic link: ${path}`,
          { details: { path } },
        );
      }
      if (kind === "directory") {
        visit(path, relativePath);
      } else if (kind === "file") {
        entries.push([relativePath, sha256(readFileSync(path))]);
      }
    }
  };

  for (const entry of readdirSync(destinationPath, {
    withFileTypes: true,
  }).sort((left, right) => byName(left.name, right.name))) {
    if (!entry.name.startsWith("planlet-")) continue;
    const path = join(destinationPath, entry.name);
    const kind = pathKind(path);
    if (kind === "symlink") {
      throw new PlanletError(
        "unsafe_path",
        `Harness installation contains a symbolic link: ${path}`,
        { details: { path } },
      );
    }
    if (kind !== "directory") {
      throw new PlanletError(
        "write_conflict",
        `Planlet skill path is not a directory: ${path}`,
        { details: { path } },
      );
    }
    visit(path, entry.name);
  }
  return sortedRecord(entries);
}

function sameRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([path, digest]) => right[path] === digest)
  );
}

function assertNoLeftoverRecoveryDirs(destinationPath: string): void {
  if (pathKind(destinationPath) !== "directory") return;
  const leftovers = readdirSync(destinationPath)
    .filter(
      (name) =>
        name.startsWith(".planlet-bak-") || name.startsWith(".planlet-tx-"),
    )
    .sort();
  if (leftovers.length === 0) return;
  const leftoverPaths = leftovers.map((name) => join(destinationPath, name));
  throw new PlanletError(
    "write_conflict",
    `Harness destination has leftover recovery directories: ${destinationPath}`,
    {
      details: {
        destination: destinationPath,
        leftoverPaths,
      },
      next: `Inspect leftover .planlet-bak-* / .planlet-tx-* under ${destinationPath}, restore managed files from backup if needed, remove the leftover dirs only when no install is running, then retry`,
    },
  );
}

function inspectDestination(
  destination: HarnessDestination,
  source: CanonicalSkillSource,
): DestinationInspection {
  assertNoLeftoverRecoveryDirs(destination.path);
  const manifestPath = join(destination.path, INSTALLATION_MANIFEST);
  const manifestKind = pathKind(manifestPath);
  if (manifestKind === "directory" || manifestKind === "symlink") {
    throw new PlanletError(
      "write_conflict",
      `Installation manifest is not a regular file: ${manifestPath}`,
      { details: { path: manifestPath } },
    );
  }
  const manifestText =
    manifestKind === "file" ? readFileSync(manifestPath, "utf8") : undefined;
  const manifest =
    manifestText === undefined
      ? undefined
      : parseInstallationManifest(manifestText, manifestPath);
  const actualFiles = collectPlanletFiles(destination.path);
  const desiredManifest = createInstallationManifest(source);
  const desiredManifestText = serializeInstallationManifest(desiredManifest);
  const actualEntries = Object.entries(actualFiles);
  // Without a manifest, an empty destination is a clean install, not a conflict.
  const expected =
    manifest?.files ??
    (actualEntries.length === 0 ? {} : desiredManifest.files);
  const conflicts = new Set<string>();
  for (const path of new Set([
    ...Object.keys(expected),
    ...Object.keys(actualFiles),
  ])) {
    // Unrecorded extras that already match the desired content are not conflicts.
    const permitted = expected[path] ?? desiredManifest.files[path];
    if (actualFiles[path] !== permitted) conflicts.add(path);
  }

  const hasFiles = actualEntries.length > 0;
  const currentSkillsMatch = sameRecord(actualFiles, desiredManifest.files);
  const manifestMatches =
    manifest !== undefined && sameRecord(manifest.files, desiredManifest.files);
  const state: HarnessState =
    manifest === undefined
      ? hasFiles
        ? "unmanaged"
        : "missing"
      : currentSkillsMatch && manifestMatches
        ? "installed"
        : "modified";

  return {
    destination,
    state,
    actualFiles,
    desiredManifestText,
    conflicts: [...conflicts].sort(),
    publishSkills: !currentSkillsMatch,
    writeManifest: manifestText !== desiredManifestText,
  };
}

/**
 * Fault-injection seams for the publish transaction. Production never sets
 * hooks; they exist because the recovery paths below cannot be reached through
 * the public API otherwise. Three steps, one per distinct outcome: a throw at
 * `afterReplaceSkill` rolls back (and fires per skill, so a fault mid-loop
 * exercises a partial rollback), at `duringRollback` leaves recovery
 * directories, at `beforeCleanup` publishes but warns. Adding a step means a
 * new outcome, not a new place to throw.
 */
type InstallTxStep = "afterReplaceSkill" | "duringRollback" | "beforeCleanup";

export interface InstallTransactionHooks {
  readonly onStep?: (step: InstallTxStep, detail?: string) => void;
}

function writeSkillTree(
  stagingSkillPath: string,
  skill: string,
  source: CanonicalSkillSource,
): void {
  mkdirSync(stagingSkillPath);
  for (const file of source.files.filter((entry) => entry.skill === skill)) {
    const relativePath = file.relativePath.slice(skill.length + 1);
    const targetFile = resolveSafePath(
      stagingSkillPath,
      ...relativePath.split("/"),
    );
    mkdirSync(dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, file.content, { flag: "wx" });
  }
}

function moveManagedEntry(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(source, destination);
}

/**
 * Stages managed skills and the manifest, then swaps them into the live
 * destination. Failures before the manifest commit roll back to the exact
 * pre-operation managed state. After commit, cleanup is best-effort and never
 * rolls back published content. Unrelated non-Planlet skills are never touched.
 */
function publishDestinationTransaction(
  destinationPath: string,
  source: CanonicalSkillSource,
  desiredManifestText: string,
  actualSkillNames: readonly string[],
  options: {
    readonly publishSkills: boolean;
    readonly writeManifest: boolean;
    readonly hooks?: InstallTransactionHooks;
  },
): readonly string[] {
  const hooks = options.hooks ?? {};
  const warnings: string[] = [];
  if (!options.publishSkills && !options.writeManifest) {
    return warnings;
  }

  const token = randomUUID();
  const stageRoot = join(destinationPath, `.planlet-tx-${token}`);
  const backupRoot = join(destinationPath, `.planlet-bak-${token}`);
  const desiredSkills = options.publishSkills ? [...source.skills] : [];
  const obsoleteSkills = options.publishSkills
    ? actualSkillNames.filter((skill) => !desiredSkills.includes(skill))
    : [];
  const liveManifest = join(destinationPath, INSTALLATION_MANIFEST);
  const mutated = new Set<string>();
  let backupReady = false;
  let committed = false;

  const emit = (step: InstallTxStep, detail?: string): void => {
    hooks.onStep?.(step, detail);
  };

  const rollback = (): void => {
    for (const name of [...mutated].reverse()) {
      emit("duringRollback", name);
      const live = join(destinationPath, name);
      const backup = join(backupRoot, name);
      rmSync(live, { recursive: true, force: true });
      if (pathKind(backup) !== "missing") {
        moveManagedEntry(backup, live);
      }
    }
  };

  try {
    mkdirSync(destinationPath, { recursive: true });
    mkdirSync(stageRoot);
    for (const skill of desiredSkills) {
      writeSkillTree(join(stageRoot, skill), skill, source);
    }
    if (options.writeManifest) {
      writeFileSync(
        join(stageRoot, INSTALLATION_MANIFEST),
        desiredManifestText,
        { encoding: "utf8", flag: "wx" },
      );
    }

    mkdirSync(backupRoot);
    backupReady = true;

    for (const skill of [...new Set([...desiredSkills, ...obsoleteSkills])]) {
      const live = resolveSafePath(destinationPath, skill);
      if (pathKind(live) === "missing") continue;
      moveManagedEntry(live, join(backupRoot, skill));
      mutated.add(skill);
    }
    if (options.writeManifest && pathKind(liveManifest) !== "missing") {
      moveManagedEntry(liveManifest, join(backupRoot, INSTALLATION_MANIFEST));
      mutated.add(INSTALLATION_MANIFEST);
    }

    for (const skill of desiredSkills) {
      moveManagedEntry(join(stageRoot, skill), join(destinationPath, skill));
      mutated.add(skill);
      emit("afterReplaceSkill", skill);
    }
    if (options.writeManifest) {
      moveManagedEntry(join(stageRoot, INSTALLATION_MANIFEST), liveManifest);
      mutated.add(INSTALLATION_MANIFEST);
    }

    // Commit point: live managed state is now the new installation.
    committed = true;
  } catch (error) {
    if (backupReady && !committed) {
      try {
        rollback();
      } catch (rollbackError) {
        // Never delete backupRoot on rollback failure; leave stage for recovery.
        throw new PlanletError(
          "write_conflict",
          `Could not roll back harness installation: ${destinationPath}`,
          {
            details: {
              destination: destinationPath,
              rollbackFailed: true,
              backupPath: backupRoot,
              stagePath: stageRoot,
              mutated: [...mutated],
              manifestPublished: false,
            },
            next: `Do not delete ${backupRoot} until managed files are restored from it. Leftover recovery dirs: ${backupRoot}, ${stageRoot}. Restore manually if needed, remove leftover .planlet-bak-* / .planlet-tx-* only when no install is running, then retry`,
            cause: new AggregateError([error, rollbackError]),
          },
        );
      }
    }
    try {
      rmSync(stageRoot, { recursive: true, force: true });
      if (!committed) rmSync(backupRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new PlanletError(
        "write_conflict",
        `Could not publish harness installation: ${destinationPath}`,
        {
          details: {
            destination: destinationPath,
            cleanupFailed: true,
            published: committed,
          },
          cause: new AggregateError([error, cleanupError]),
        },
      );
    }
    throw asWriteConflict(
      error,
      `Could not publish harness installation: ${destinationPath}`,
      { destination: destinationPath },
    );
  }

  try {
    emit("beforeCleanup");
    rmSync(stageRoot, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  } catch {
    warnings.push(
      `Harness installation published but cleanup was incomplete at ${destinationPath}`,
    );
  }

  return warnings;
}

export function installHarnessSkills(options: {
  readonly repositoryRoot: string;
  readonly operation: "init" | "update";
  readonly tools?: string | undefined;
  readonly force?: boolean | undefined;
  readonly source?: CanonicalSkillSource | undefined;
  /** @internal Fault-injection seam for the publish transaction. Tests only. */
  readonly transactionHooks?: InstallTransactionHooks | undefined;
  readonly lock?: Partial<PlanletLockDependencies> | undefined;
}): InstallationOutcome {
  const selectedToolIds = normalizeToolSelector(options.tools);
  const destinations = resolveHarnessDestinations(
    options.repositoryRoot,
    selectedToolIds,
  );
  const plansPath = resolveSafePath(options.repositoryRoot, "plans");
  const plansKind = pathKind(plansPath);
  if (
    options.operation === "init" &&
    plansKind !== "missing" &&
    plansKind !== "directory"
  ) {
    throw new PlanletError(
      "write_conflict",
      `Plans path is not a directory: ${plansPath}`,
      {
        details: { path: plansPath },
      },
    );
  }

  if (destinations.length === 0) {
    const plansInitialized =
      options.operation === "init" && plansKind === "missing";
    if (plansInitialized) mkdirSync(plansPath, { recursive: true });
    return {
      data: {
        operation: options.operation,
        changed: plansInitialized,
        plansInitialized,
        destinations: [],
      },
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const { value, releaseWarning } = withHarnessInstallLock(
    options.repositoryRoot,
    () => {
      const source = options.source ?? enumerateCanonicalSkills();
      const inspections = destinations.map((destination) =>
        inspectDestination(destination, source),
      );
      const actionable = inspections.filter(
        (inspection) =>
          options.operation === "init" || inspection.state !== "missing",
      );
      const conflicts = actionable.flatMap((inspection) =>
        inspection.conflicts.map((path) => ({
          destination: inspection.destination.relativePath,
          path,
        })),
      );
      if (conflicts.length > 0 && options.force !== true) {
        throw new PlanletError(
          "write_conflict",
          `Harness installation has locally modified files: ${conflicts[0]!.destination}/${conflicts[0]!.path}`,
          { details: { conflicts } },
        );
      }

      const plansInitialized =
        options.operation === "init" && plansKind === "missing";
      if (plansInitialized) mkdirSync(plansPath, { recursive: true });
      const summaries = inspections.map((inspection) =>
        options.operation === "update" && inspection.state === "missing"
          ? {
              destination: inspection.destination.relativePath,
              tools: inspection.destination.selectedToolIds,
              state: "missing" as const,
              changed: false,
              files: 0,
            }
          : applyInspectionWithSource(
              inspection,
              source,
              warnings,
              options.transactionHooks,
            ),
      );

      return {
        operation: options.operation,
        changed:
          plansInitialized || summaries.some((summary) => summary.changed),
        plansInitialized,
        destinations: summaries,
      };
    },
    options.lock,
  );

  if (releaseWarning !== undefined) warnings.push(releaseWarning);
  return { data: value, warnings };
}

function applyInspectionWithSource(
  inspection: DestinationInspection,
  source: CanonicalSkillSource,
  warnings: string[],
  hooks: InstallTransactionHooks = {},
): HarnessInstallationSummary {
  const changed = inspection.publishSkills || inspection.writeManifest;
  if (changed) {
    warnings.push(
      ...publishDestinationTransaction(
        inspection.destination.path,
        source,
        inspection.desiredManifestText,
        [
          ...new Set(
            Object.keys(inspection.actualFiles).map(
              (path) => path.split("/")[0]!,
            ),
          ),
        ],
        {
          publishSkills: inspection.publishSkills,
          writeManifest: inspection.writeManifest,
          hooks,
        },
      ),
    );
  }

  return {
    destination: inspection.destination.relativePath,
    tools: inspection.destination.selectedToolIds,
    state: "installed" as const,
    changed,
    files: source.files.length,
  };
}

export function detectHarnesses(options: {
  readonly repositoryRoot: string;
  readonly source?: CanonicalSkillSource;
}): readonly DetectedHarness[] {
  const source = options.source ?? enumerateCanonicalSkills();
  const stateByPath = new Map(
    resolveHarnessDestinations(
      options.repositoryRoot,
      normalizeToolSelector("all"),
    ).map((destination) => {
      let state: HarnessState;
      try {
        state = inspectDestination(destination, source).state;
      } catch (error) {
        if (!isPlanletError(error) || error.code !== "write_conflict") {
          throw error;
        }
        // A destination we cannot parse is reported as modified, not fatal.
        state = "modified";
      }
      return [destination.path, state] as const;
    }),
  );

  return HARNESS_ADAPTERS.map((adapter) => ({
    id: adapter.id,
    name: adapter.displayName,
    destination: adapter.skillDirectory,
    state: stateByPath.get(
      resolveSafePath(options.repositoryRoot, adapter.skillDirectory),
    )!,
  }));
}

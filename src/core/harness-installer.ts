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

import { PlanletError, isPlanletError } from "../errors/planlet-error.js";
import {
  HARNESS_ADAPTERS,
  normalizeToolSelector,
  resolveHarnessDestinations,
  type HarnessDestination,
  type HarnessToolId,
} from "./harnesses.js";
import { resolveSafePath, tryLstat } from "./paths.js";
import { withHarnessInstallLock } from "./planlet-lock.js";
import type { PlanletLockDependencies } from "./planlet-lock.js";
import {
  enumerateCanonicalSkills,
  sha256,
  type CanonicalSkillSource,
} from "./skill-source.js";

export const INSTALLATION_MANIFEST = ".planlet-manifest.json";
export const INSTALLATION_MANIFEST_VERSION = 1;

export interface InstallationManifest {
  readonly schemaVersion: typeof INSTALLATION_MANIFEST_VERSION;
  readonly tools: readonly HarnessToolId[];
  readonly files: Readonly<Record<string, string>>;
}

export type HarnessState = "missing" | "unmanaged" | "installed" | "modified";

export interface HarnessInstallationSummary {
  readonly destination: string;
  readonly tools: readonly HarnessToolId[];
  readonly state: HarnessState;
  readonly changed: boolean;
  readonly files: number;
  readonly warnings?: readonly string[];
}

export interface InstallationSummary {
  readonly operation: "init" | "update";
  readonly changed: boolean;
  readonly plansInitialized: boolean;
  readonly destinations: readonly HarnessInstallationSummary[];
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
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function createInstallationManifest(
  aliases: readonly HarnessToolId[],
  source: CanonicalSkillSource,
): InstallationManifest {
  return {
    schemaVersion: INSTALLATION_MANIFEST_VERSION,
    tools: [...aliases].sort(),
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
  const tools = candidate.tools;
  const files = candidate.files;
  const validTools =
    Array.isArray(tools) &&
    tools.length > 0 &&
    tools.every(
      (tool): tool is HarnessToolId =>
        typeof tool === "string" &&
        HARNESS_ADAPTERS.some((adapter) => adapter.id === tool),
    ) &&
    new Set(tools).size === tools.length;
  if (
    candidate.schemaVersion !== INSTALLATION_MANIFEST_VERSION ||
    !validTools ||
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
    tools: [...(tools as HarnessToolId[])],
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
      (left: Dirent, right: Dirent) => left.name.localeCompare(right.name),
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
  }).sort((left, right) => left.name.localeCompare(right.name))) {
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

function listRecoveryLeftovers(destinationPath: string): string[] {
  if (pathKind(destinationPath) !== "directory") return [];
  return readdirSync(destinationPath)
    .filter(
      (name) =>
        name.startsWith(".planlet-bak-") || name.startsWith(".planlet-tx-"),
    )
    .sort();
}

function assertNoLeftoverRecoveryDirs(destinationPath: string): void {
  const leftovers = listRecoveryLeftovers(destinationPath);
  if (leftovers.length === 0) return;
  const leftoverPaths = leftovers.map((name) => join(destinationPath, name));
  throw new PlanletError(
    "write_conflict",
    `Harness destination has leftover recovery directories: ${destinationPath}`,
    {
      details: {
        destination: destinationPath,
        leftoverPaths,
        next: `Inspect leftover .planlet-bak-* / .planlet-tx-* under ${destinationPath}, restore managed files from backup if needed, remove the leftover dirs only when no install is running, then retry`,
      },
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
  const desiredManifest = createInstallationManifest(
    destination.aliases,
    source,
  );
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
    manifest !== undefined &&
    sameRecord(manifest.files, desiredManifest.files) &&
    manifest.tools.length === desiredManifest.tools.length &&
    new Set(manifest.tools).size === new Set(desiredManifest.tools).size &&
    desiredManifest.tools.every((tool) => manifest.tools.includes(tool));
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

function asWriteConflict(error: unknown, destination: string): PlanletError {
  if (isPlanletError(error)) return error;
  return new PlanletError(
    "write_conflict",
    `Could not publish harness installation: ${destination}`,
    { details: { destination }, cause: error },
  );
}

export type InstallTxStep =
  | "afterStage"
  | "afterBackup"
  | "afterReplaceSkill"
  | "afterRemoveObsolete"
  | "beforeManifest"
  | "afterCommit"
  | "duringRollback"
  | "afterCleanup";

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

function bestEffortRemove(path: string): void {
  rmSync(path, { recursive: true, force: true });
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
    emit("afterStage");

    mkdirSync(backupRoot);
    backupReady = true;

    for (const skill of [...new Set([...desiredSkills, ...obsoleteSkills])]) {
      const live = resolveSafePath(destinationPath, skill);
      if (pathKind(live) === "missing") continue;
      moveManagedEntry(live, join(backupRoot, skill));
      mutated.add(skill);
      emit("afterBackup", skill);
    }
    if (obsoleteSkills.length > 0) {
      emit("afterRemoveObsolete");
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
      emit("beforeManifest");
      moveManagedEntry(join(stageRoot, INSTALLATION_MANIFEST), liveManifest);
      mutated.add(INSTALLATION_MANIFEST);
    }

    // Commit point: live managed state is now the new installation.
    committed = true;
    emit("afterCommit");
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
              next: `Do not delete ${backupRoot} until managed files are restored from it. Leftover recovery dirs: ${backupRoot}, ${stageRoot}. Restore manually if needed, remove leftover .planlet-bak-* / .planlet-tx-* only when no install is running, then retry`,
            },
            cause: new AggregateError([error, rollbackError]),
          },
        );
      }
    }
    try {
      bestEffortRemove(stageRoot);
      if (!committed) bestEffortRemove(backupRoot);
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
    throw asWriteConflict(error, destinationPath);
  }

  try {
    emit("afterCleanup");
    bestEffortRemove(stageRoot);
    bestEffortRemove(backupRoot);
  } catch (cleanupError) {
    warnings.push(
      `Harness installation published but cleanup was incomplete at ${destinationPath}`,
    );
    void cleanupError;
  }

  return warnings;
}

export function installHarnessSkills(options: {
  readonly repositoryRoot: string;
  readonly operation: "init" | "update";
  readonly tools?: string | undefined;
  readonly force?: boolean | undefined;
  readonly source?: CanonicalSkillSource | undefined;
  readonly transactionHooks?: InstallTransactionHooks | undefined;
  readonly lock?: Partial<PlanletLockDependencies> | undefined;
}): InstallationSummary {
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
      operation: options.operation,
      changed: plansInitialized,
      plansInitialized,
      destinations: [],
    };
  }

  return withHarnessInstallLock(
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
}

function applyInspectionWithSource(
  inspection: DestinationInspection,
  source: CanonicalSkillSource,
  hooks: InstallTransactionHooks = {},
): HarnessInstallationSummary {
  const changed = inspection.publishSkills || inspection.writeManifest;
  const warnings = changed
    ? publishDestinationTransaction(
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
      )
    : [];

  return {
    destination: inspection.destination.relativePath,
    tools: inspection.destination.selectedToolIds,
    state: "installed" as const,
    changed,
    files: source.files.length,
    ...(warnings.length > 0 ? { warnings } : {}),
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

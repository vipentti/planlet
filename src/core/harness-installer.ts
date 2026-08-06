import { mkdirSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";

import { PlanletError, isPlanletError } from "../errors/planlet-error.js";
import { updateAgentFiles, type AgentFileState } from "./agent-snippet.js";
import {
  HARNESS_ADAPTERS,
  normalizeToolSelector,
  resolveHarnessDestinations,
  type HarnessDestination,
  type HarnessToolId,
} from "./harnesses.js";
import { byName, pathKind, resolveSafePath, sortedRecord } from "./paths.js";
import {
  INSTALLATION_MANIFEST,
  createInstallationManifest,
  parseInstallationManifest,
  serializeInstallationManifest,
} from "./harness-manifest.js";
import {
  publishDestinationTransaction,
  type InstallTransactionHooks,
} from "./harness-publish.js";
import { withHarnessInstallLock } from "./planlet-lock.js";
import type { PlanletLockDependencies } from "./planlet-lock.js";
import {
  enumerateCanonicalSkills,
  sha256,
  type CanonicalSkillSource,
} from "./skill-source.js";

export {
  INSTALLATION_MANIFEST,
  createInstallationManifest,
  parseInstallationManifest,
  serializeInstallationManifest,
} from "./harness-manifest.js";
export type { InstallationManifest } from "./harness-manifest.js";
export type { InstallTransactionHooks } from "./harness-publish.js";

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
  readonly agentFiles: Readonly<Record<string, AgentFileState>>;
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

export function installHarnessSkills(options: {
  readonly repositoryRoot: string;
  readonly operation: "init" | "update";
  readonly tools?: string | undefined;
  readonly force?: boolean | undefined;
  readonly noAgents?: boolean | undefined;
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

  const warnings: string[] = [];
  const { value, releaseWarning } = withHarnessInstallLock(
    options.repositoryRoot,
    () => {
      const plansInitialized =
        options.operation === "init" && plansKind === "missing";

      let summaries: readonly HarnessInstallationSummary[] = [];
      if (destinations.length > 0) {
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

        // Preflight passed: only now mutate the repository.
        if (plansInitialized) mkdirSync(plansPath, { recursive: true });
        summaries = inspections.map((inspection) =>
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
      } else if (plansInitialized) {
        mkdirSync(plansPath, { recursive: true });
      }

      // Agent files are written only after every destination inspected and
      // published: a non-forced conflict or publication failure must not leave
      // AGENTS.md/CLAUDE.md written or staged.
      const agents = updateAgentFiles({
        repositoryRoot: options.repositoryRoot,
        operation: options.operation,
        skip: options.noAgents,
      });
      warnings.push(...agents.warnings);

      return {
        operation: options.operation,
        changed:
          plansInitialized ||
          summaries.some((summary) => summary.changed) ||
          agents.changed,
        plansInitialized,
        destinations: summaries,
        agentFiles: agents.files,
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

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

function inspectDestination(
  destination: HarnessDestination,
  source: CanonicalSkillSource,
): DestinationInspection {
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

/**
 * Builds `name` beside its destination and swaps it in with one rename, keeping
 * the previous copy as a backup that is restored if any step fails.
 */
function atomicReplace(
  destinationPath: string,
  name: string,
  write: (staging: string) => void,
): void {
  const target = join(destinationPath, name);
  const token = randomUUID();
  const staging = join(destinationPath, `.${name}.stage-${token}`);
  const backup = join(destinationPath, `.${name}.backup-${token}`);
  let backedUp = false;
  try {
    write(staging);
    if (pathKind(target) !== "missing") {
      renameSync(target, backup);
      backedUp = true;
    }
    renameSync(staging, target);
    if (backedUp) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (backedUp && pathKind(target) === "missing") renameSync(backup, target);
    throw asWriteConflict(error, destinationPath);
  }
}

function publishSkill(
  destinationPath: string,
  skill: string,
  source: CanonicalSkillSource,
): void {
  atomicReplace(destinationPath, skill, (staging) => {
    mkdirSync(staging);
    for (const file of source.files.filter((entry) => entry.skill === skill)) {
      const relativePath = file.relativePath.slice(skill.length + 1);
      const targetFile = resolveSafePath(staging, ...relativePath.split("/"));
      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, file.content, { flag: "wx" });
    }
  });
}

function publishManifest(destinationPath: string, content: string): void {
  atomicReplace(destinationPath, INSTALLATION_MANIFEST, (staging) => {
    writeFileSync(staging, content, { encoding: "utf8", flag: "wx" });
  });
}

export function installHarnessSkills(options: {
  readonly repositoryRoot: string;
  readonly operation: "init" | "update";
  readonly tools?: string | undefined;
  readonly force?: boolean | undefined;
  readonly source?: CanonicalSkillSource | undefined;
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
      : applyInspectionWithSource(inspection, source),
  );

  return {
    operation: options.operation,
    changed: plansInitialized || summaries.some((summary) => summary.changed),
    plansInitialized,
    destinations: summaries,
  };
}

function applyInspectionWithSource(
  inspection: DestinationInspection,
  source: CanonicalSkillSource,
): HarnessInstallationSummary {
  const changed = inspection.publishSkills || inspection.writeManifest;
  if (changed) {
    mkdirSync(inspection.destination.path, { recursive: true });
    if (inspection.publishSkills) {
      const desiredSkills = new Set(source.skills);
      const actualSkills = new Set(
        Object.keys(inspection.actualFiles).map((path) => path.split("/")[0]!),
      );
      for (const skill of actualSkills) {
        if (!desiredSkills.has(skill)) {
          rmSync(resolveSafePath(inspection.destination.path, skill), {
            recursive: true,
            force: true,
          });
        }
      }
      for (const skill of source.skills) {
        publishSkill(inspection.destination.path, skill, source);
      }
    }
    if (inspection.writeManifest) {
      publishManifest(
        inspection.destination.path,
        inspection.desiredManifestText,
      );
    }
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

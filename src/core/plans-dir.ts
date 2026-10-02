import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { PlanletError } from "../errors/planlet-error.js";
import { pathKind, resolveSafePath, tryLstat } from "./paths.js";

export const DEFAULT_PLANS_DIR = "plans";
export const PLANLET_CONFIG_FILENAME = ".planlet.json";

const RESERVED_CONFIG_FILENAMES = [
  ".planlet.yaml",
  ".planlet.yml",
  ".planletrc.json",
  ".planlet.config.json",
] as const;

const CONFIG_CANDIDATE_FILENAMES = [
  PLANLET_CONFIG_FILENAME,
  ...RESERVED_CONFIG_FILENAMES,
] as const;

const PLANS_DIR_SEGMENT = /^[A-Za-z0-9._-]+$/;
const PLANS_DIR_FORBIDDEN = /[\s*?[\]]/;

export interface ResolvedPlansLocation {
  readonly plansDir: string;
  readonly plansPath: string;
}

export function hasPlansLayoutMarker(path: string): boolean {
  if (tryLstat(join(path, DEFAULT_PLANS_DIR))?.isDirectory() === true) {
    return true;
  }
  return CONFIG_CANDIDATE_FILENAMES.some(
    (name) => tryLstat(join(path, name)) !== null,
  );
}

export function assertValidPlansDir(value: string): string {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    PLANS_DIR_FORBIDDEN.test(value)
  ) {
    throw invalidPlansDir(value);
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !PLANS_DIR_SEGMENT.test(segment),
    )
  ) {
    throw invalidPlansDir(value);
  }
  return value;
}

export function joinPlansRelative(
  plansDir: string,
  ...parts: readonly string[]
): string {
  return [plansDir, ...parts].join("/");
}

export function plansDirPathspec(plansDir: string): string {
  return `${plansDir}/`;
}

export function resolveUnderPlans(
  repositoryRoot: string,
  plansDir: string,
  ...relativeSegments: readonly string[]
): string {
  return resolveSafePath(
    repositoryRoot,
    ...plansDir.split("/"),
    ...relativeSegments,
  );
}

export function readPlansDir(repositoryRoot: string): string {
  const present = presentConfigFiles(repositoryRoot);
  if (present.length > 1) {
    throw new PlanletError(
      "invalid_config",
      `Multiple Planlet config files: ${present.join(", ")}`,
      {
        details: { files: present },
        next: "Keep exactly one config file named .planlet.json",
      },
    );
  }
  const reserved = present.filter((name) => name !== PLANLET_CONFIG_FILENAME);
  if (reserved.length > 0) {
    throw reservedConfigError(reserved[0]!);
  }

  const plansDir =
    present[0] === PLANLET_CONFIG_FILENAME
      ? parsePlansDirFile(repositoryRoot)
      : DEFAULT_PLANS_DIR;
  assertNoLeftoverDefaultPlans(repositoryRoot, plansDir);
  return plansDir;
}

export function resolvePlansLocation(
  repositoryRoot: string,
): ResolvedPlansLocation {
  const plansDir = readPlansDir(repositoryRoot);
  return {
    plansDir,
    plansPath: resolveUnderPlans(repositoryRoot, plansDir),
  };
}

export function requirePlansDirectory(
  repositoryRoot: string,
): ResolvedPlansLocation {
  const location = resolvePlansLocation(repositoryRoot);
  if (tryLstat(location.plansPath)?.isDirectory() !== true) {
    throw new PlanletError(
      "plans_not_initialized",
      "Repository does not contain a plans directory",
      { details: { path: location.plansPath, plansDir: location.plansDir } },
    );
  }
  return location;
}

function presentConfigFiles(repositoryRoot: string): string[] {
  return CONFIG_CANDIDATE_FILENAMES.filter(
    (name) => tryLstat(join(repositoryRoot, name)) !== null,
  );
}

function parsePlansDirFile(repositoryRoot: string): string {
  const configPath = join(repositoryRoot, PLANLET_CONFIG_FILENAME);
  const kind = pathKind(configPath);
  if (kind === "directory") {
    throw new PlanletError(
      "invalid_config",
      `Planlet config path is not a regular file: ${configPath}`,
      {
        details: { path: configPath },
        next: "Replace .planlet.json with a JSON object that may set plansDir",
      },
    );
  }
  let resolvedPath: string;
  try {
    resolvedPath = resolveSafePath(repositoryRoot, PLANLET_CONFIG_FILENAME);
  } catch (error) {
    if (error instanceof PlanletError) {
      throw new PlanletError(
        "invalid_config",
        `Cannot read Planlet config: ${PLANLET_CONFIG_FILENAME}`,
        { details: { path: configPath }, cause: error },
      );
    }
    throw error;
  }
  if (tryLstat(resolvedPath)?.isFile() !== true) {
    throw new PlanletError(
      "invalid_config",
      `Planlet config path is not a regular file: ${configPath}`,
      {
        details: { path: configPath },
        next: "Replace .planlet.json with a JSON object that may set plansDir",
      },
    );
  }

  let text: string;
  try {
    text = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new PlanletError(
      "invalid_config",
      `Cannot read Planlet config: ${configPath}`,
      { details: { path: configPath }, cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new PlanletError(
      "invalid_config",
      `Invalid JSON in ${PLANLET_CONFIG_FILENAME}`,
      { details: { path: configPath }, cause: error },
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PlanletError(
      "invalid_config",
      `${PLANLET_CONFIG_FILENAME} must be a JSON object`,
      {
        details: { path: configPath },
        next: 'Use a JSON object such as { "plansDir": "docs/plans" }',
      },
    );
  }
  const record = parsed as Record<string, unknown>;
  if (!Object.hasOwn(record, "plansDir")) {
    return DEFAULT_PLANS_DIR;
  }
  if (typeof record.plansDir !== "string") {
    throw new PlanletError("invalid_config", "plansDir must be a string", {
      details: { path: configPath, plansDir: record.plansDir },
      next: "Set plansDir to a relative posix path such as docs/plans",
    });
  }
  return assertValidPlansDir(record.plansDir);
}

function assertNoLeftoverDefaultPlans(
  repositoryRoot: string,
  plansDir: string,
): void {
  if (plansDir === DEFAULT_PLANS_DIR) {
    return;
  }
  const leftoverPath = join(repositoryRoot, DEFAULT_PLANS_DIR);
  if (tryLstat(leftoverPath)?.isDirectory() !== true) {
    return;
  }
  let entries: readonly { readonly name: string }[];
  try {
    entries = readdirSync(leftoverPath, { withFileTypes: true });
  } catch (error) {
    throw new PlanletError(
      "plans_dir_conflict",
      `Cannot inspect leftover ${DEFAULT_PLANS_DIR}/ directory`,
      { details: { path: leftoverPath, plansDir }, cause: error },
    );
  }
  const leftoverNames = entries
    .filter((entry) => isLeftoverDirectory(join(leftoverPath, entry.name)))
    .map((entry) => entry.name);
  if (leftoverNames.length === 0) {
    return;
  }
  throw new PlanletError(
    "plans_dir_conflict",
    `Leftover ${DEFAULT_PLANS_DIR}/ still contains planlet directories while plansDir is ${plansDir}`,
    {
      details: { path: leftoverPath, plansDir, leftover: leftoverNames },
      next: `git mv the contents of ${DEFAULT_PLANS_DIR}/ to ${plansDir}/ and keep ${PLANLET_CONFIG_FILENAME} in the same commit`,
    },
  );
}

function isLeftoverDirectory(path: string): boolean {
  const stats = tryLstat(path);
  if (stats === null) {
    return false;
  }
  if (stats.isDirectory()) {
    return true;
  }
  if (!stats.isSymbolicLink()) {
    return false;
  }
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function reservedConfigError(name: string): PlanletError {
  const yaml = name.endsWith(".yaml") || name.endsWith(".yml");
  return new PlanletError(
    "invalid_config",
    yaml
      ? `YAML Planlet config is not supported yet: ${name}`
      : `Unrecognized Planlet config file: ${name}`,
    {
      details: { file: name },
      next: "Use .planlet.json with a plansDir string",
    },
  );
}

function invalidPlansDir(value: string): PlanletError {
  return new PlanletError("invalid_config", `Invalid plansDir: ${value}`, {
    details: { plansDir: value },
    next: "Use a relative posix path with no .., empty, or glob segments",
  });
}

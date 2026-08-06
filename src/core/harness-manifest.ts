import { PlanletError } from "../errors/planlet-error.js";
import { byName } from "./paths.js";
import type { CanonicalSkillSource } from "./skill-source.js";

export const INSTALLATION_MANIFEST = ".planlet-manifest.json";
const INSTALLATION_MANIFEST_VERSION = 2;

export interface InstallationManifest {
  readonly schemaVersion: typeof INSTALLATION_MANIFEST_VERSION;
  readonly files: Readonly<Record<string, string>>;
}

export function sortedRecord(
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
  const schemaVersion = candidate.schemaVersion;
  const isV1 = schemaVersion === 1;
  if (
    (!isV1 && schemaVersion !== INSTALLATION_MANIFEST_VERSION) ||
    (schemaVersion === INSTALLATION_MANIFEST_VERSION &&
      candidate.tools !== undefined) ||
    !isStringRecord(files)
  ) {
    throw new PlanletError(
      "write_conflict",
      `Invalid installation manifest: ${path}`,
      {
        details: { path, schemaVersion },
      },
    );
  }

  return {
    schemaVersion: INSTALLATION_MANIFEST_VERSION,
    files: sortedRecord(Object.entries(files)),
  };
}

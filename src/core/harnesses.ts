import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";

import { PlanletError } from "../errors/planlet-error.js";
import { resolveSafePath, tryLstat } from "./paths.js";

type HarnessMarker = Readonly<{
  readonly relativePath: string;
  readonly kind: "directory" | "file";
  readonly planletOnly?: "agents-root" | "skills-directory";
}>;

const PLANLET_MANIFEST = ".planlet-manifest.json";

export const HARNESS_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "agents",
    displayName: "Generic Agent Skills",
    skillDirectory: ".agents/skills",
    presenceMarkers: Object.freeze([
      Object.freeze({
        relativePath: ".agents",
        kind: "directory",
        planletOnly: "agents-root",
      }),
    ]),
  }),
  Object.freeze({
    id: "claude",
    displayName: "Claude Code",
    skillDirectory: ".claude/skills",
    presenceMarkers: Object.freeze([
      Object.freeze({
        relativePath: ".claude/skills",
        kind: "directory",
        planletOnly: "skills-directory",
      }),
      Object.freeze({
        relativePath: ".claude/settings.json",
        kind: "file",
      }),
      Object.freeze({
        relativePath: ".claude/settings.local.json",
        kind: "file",
      }),
      Object.freeze({ relativePath: ".claude/agents", kind: "directory" }),
      Object.freeze({ relativePath: ".claude/rules", kind: "directory" }),
      Object.freeze({ relativePath: ".claude/CLAUDE.md", kind: "file" }),
      Object.freeze({
        relativePath: ".claude/commands",
        kind: "directory",
      }),
    ]),
  }),
  Object.freeze({
    id: "codex",
    displayName: "Codex",
    skillDirectory: ".agents/skills",
    presenceMarkers: Object.freeze([
      Object.freeze({ relativePath: ".codex", kind: "directory" }),
    ]),
  }),
  Object.freeze({
    id: "github-copilot",
    displayName: "GitHub Copilot",
    skillDirectory: ".agents/skills",
    presenceMarkers: Object.freeze([
      Object.freeze({
        relativePath: ".github/copilot-instructions.md",
        kind: "file",
      }),
      Object.freeze({
        relativePath: ".github/instructions",
        kind: "directory",
      }),
      Object.freeze({ relativePath: ".github/skills", kind: "directory" }),
      Object.freeze({ relativePath: ".github/prompts", kind: "directory" }),
      Object.freeze({ relativePath: ".github/agents", kind: "directory" }),
    ]),
  }),
] as const);

type HarnessAdapter = (typeof HARNESS_ADAPTERS)[number];
export type HarnessToolId = HarnessAdapter["id"];

function hasPlanletSkillEntry(entry: Dirent): boolean {
  return (
    (entry.isDirectory() && entry.name.startsWith("planlet-")) ||
    (entry.isFile() && entry.name === PLANLET_MANIFEST)
  );
}

function isPlanletOnlySkillsDirectory(path: string): boolean {
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.length > 0 && entries.every(hasPlanletSkillEntry);
}

function markerPath(
  repositoryRoot: string,
  marker: HarnessMarker,
): string | undefined {
  try {
    return resolveSafePath(repositoryRoot, ...marker.relativePath.split("/"));
  } catch (error) {
    if (error instanceof PlanletError && error.code === "unsafe_path") {
      return undefined;
    }
    throw error;
  }
}

function hasMarker(repositoryRoot: string, marker: HarnessMarker): boolean {
  const path = markerPath(repositoryRoot, marker);
  if (path === undefined) return false;

  const stats = tryLstat(path);
  if (stats === null) return false;
  if (marker.kind === "directory" && !stats.isDirectory()) return false;
  if (marker.kind === "file" && !stats.isFile()) return false;
  if (marker.planletOnly === undefined) return true;

  const entries = readdirSync(path, { withFileTypes: true });
  if (marker.planletOnly === "skills-directory") {
    return !isPlanletOnlySkillsDirectory(path);
  }

  if (
    entries.length !== 1 ||
    entries[0]!.name !== "skills" ||
    !entries[0]!.isDirectory()
  ) {
    return true;
  }

  return !isPlanletOnlySkillsDirectory(join(path, "skills"));
}

export function detectHarnessSignals(
  repositoryRoot: string,
): readonly HarnessToolId[] {
  return HARNESS_ADAPTERS.filter((adapter) =>
    adapter.presenceMarkers.some((marker) => hasMarker(repositoryRoot, marker)),
  ).map((adapter) => adapter.id);
}

export interface HarnessDestination {
  readonly path: string;
  readonly relativePath: string;
  readonly selectedToolIds: readonly HarnessToolId[];
  readonly aliases: readonly HarnessToolId[];
}

function unsupported(message: string, selector: string): never {
  throw new PlanletError("unsupported_tool", message, {
    details: {
      selector,
      supported: HARNESS_ADAPTERS.map((adapter) => adapter.id),
    },
  });
}

export function normalizeToolSelector(
  selector: string | undefined,
): readonly HarnessToolId[] {
  const normalized = selector ?? "all";
  const values = normalized.split(",").map((value) => value.trim());
  if (values.some((value) => value.length === 0)) {
    unsupported("Tool selector contains an empty value", normalized);
  }

  const unique = [...new Set(values)];
  if (unique.includes("all") || unique.includes("none")) {
    if (unique.length !== 1) {
      unsupported("The all and none selectors must be used alone", normalized);
    }
    return unique[0] === "none"
      ? []
      : HARNESS_ADAPTERS.map((adapter) => adapter.id);
  }

  const supported = new Set<string>(
    HARNESS_ADAPTERS.map((adapter) => adapter.id),
  );
  const unknown = unique.filter((value) => !supported.has(value));
  if (unknown.length > 0) {
    throw new PlanletError(
      "unsupported_tool",
      `Unsupported tool ID: ${unknown.join(", ")}`,
      {
        details: {
          selector: normalized,
          unsupported: unknown,
          supported: [...supported],
        },
      },
    );
  }

  const selected = new Set(unique);
  return HARNESS_ADAPTERS.filter((adapter) => selected.has(adapter.id)).map(
    (adapter) => adapter.id,
  );
}

/**
 * Resolves selected harness destinations. Unselected adapters that safely
 * resolve to the same physical path are included as aliases; unselected
 * adapters that escape or fail to resolve are ignored and do not block.
 */
export function resolveHarnessDestinations(
  repositoryRoot: string,
  selectedToolIds: readonly HarnessToolId[],
): readonly HarnessDestination[] {
  const selected = new Set<HarnessToolId>(selectedToolIds);
  const resolved = HARNESS_ADAPTERS.map((adapter) => {
    try {
      return {
        adapter,
        path: resolveSafePath(repositoryRoot, adapter.skillDirectory),
      };
    } catch (error) {
      if (selected.has(adapter.id)) throw error;
      return { adapter, path: undefined };
    }
  });

  const byPath = new Map<string, HarnessAdapter[]>();
  for (const entry of resolved) {
    if (entry.path === undefined) continue;
    const bucket = byPath.get(entry.path);
    if (bucket === undefined) {
      byPath.set(entry.path, [entry.adapter]);
    } else {
      bucket.push(entry.adapter);
    }
  }

  return [...byPath]
    .map(([path, adapters]) => {
      const selectedAdapters = adapters.filter((adapter) =>
        selected.has(adapter.id),
      );
      if (selectedAdapters.length === 0) return undefined;
      return {
        path,
        relativePath: selectedAdapters[0]!.skillDirectory,
        selectedToolIds: selectedAdapters.map((adapter) => adapter.id),
        aliases: adapters.map((adapter) => adapter.id),
      };
    })
    .filter((destination) => destination !== undefined);
}

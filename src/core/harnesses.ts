import { PlanletError } from "../errors/planlet-error.js";
import { resolveSafePath } from "./paths.js";

export const HARNESS_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "agents",
    displayName: "Generic Agent Skills",
    skillDirectory: ".agents/skills",
  }),
  Object.freeze({
    id: "claude",
    displayName: "Claude Code",
    skillDirectory: ".claude/skills",
  }),
  Object.freeze({
    id: "codex",
    displayName: "Codex",
    skillDirectory: ".agents/skills",
  }),
] as const);

export type HarnessAdapter = (typeof HARNESS_ADAPTERS)[number];
export type HarnessToolId = HarnessAdapter["id"];

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

export function resolveHarnessDestinations(
  repositoryRoot: string,
  selectedToolIds: readonly HarnessToolId[],
): readonly HarnessDestination[] {
  const selected = new Set<HarnessToolId>(selectedToolIds);
  // Group by resolved path, not directory name: codex and agents share a
  // directory, and a symlinked .claude/skills must coalesce the same way.
  const aliasesByPath = new Map<string, HarnessToolId[]>();
  const relativeByPath = new Map<string, string>();
  for (const adapter of HARNESS_ADAPTERS) {
    const path = resolveSafePath(repositoryRoot, adapter.skillDirectory);
    const aliases = aliasesByPath.get(path);
    if (aliases === undefined) {
      aliasesByPath.set(path, [adapter.id]);
      relativeByPath.set(path, adapter.skillDirectory);
    } else {
      aliases.push(adapter.id);
    }
  }

  return [...aliasesByPath]
    .map(([path, aliases]) => ({
      path,
      relativePath: relativeByPath.get(path)!,
      selectedToolIds: aliases.filter((id) => selected.has(id)),
      aliases,
    }))
    .filter((destination) => destination.selectedToolIds.length > 0);
}

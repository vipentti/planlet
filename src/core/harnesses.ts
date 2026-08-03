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
    if (selected.has(adapter.id)) {
      return {
        adapter,
        path: resolveSafePath(repositoryRoot, adapter.skillDirectory),
      };
    }
    try {
      return {
        adapter,
        path: resolveSafePath(repositoryRoot, adapter.skillDirectory),
      };
    } catch {
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

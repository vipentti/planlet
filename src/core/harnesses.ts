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
      ? Object.freeze([])
      : Object.freeze(HARNESS_ADAPTERS.map((adapter) => adapter.id));
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
  return Object.freeze(
    HARNESS_ADAPTERS.filter((adapter) => selected.has(adapter.id)).map(
      (adapter) => adapter.id,
    ),
  );
}

export function resolveHarnessDestinations(
  repositoryRoot: string,
  selectedToolIds: readonly HarnessToolId[],
): readonly HarnessDestination[] {
  const selected = new Set<HarnessToolId>(selectedToolIds);
  const destinations = new Map<
    string,
    {
      relativePath: string;
      selectedToolIds: HarnessToolId[];
      aliases: HarnessToolId[];
    }
  >();

  for (const adapter of HARNESS_ADAPTERS) {
    const path = resolveSafePath(repositoryRoot, adapter.skillDirectory);
    let destination = destinations.get(path);
    if (destination === undefined) {
      destination = {
        relativePath: adapter.skillDirectory,
        selectedToolIds: [],
        aliases: [],
      };
      destinations.set(path, destination);
    }
    destination.aliases.push(adapter.id);
    if (selected.has(adapter.id)) destination.selectedToolIds.push(adapter.id);
  }

  return Object.freeze(
    [...destinations.entries()]
      .filter(([, destination]) => destination.selectedToolIds.length > 0)
      .map(([path, destination]) =>
        Object.freeze({
          path,
          relativePath: destination.relativePath,
          selectedToolIds: Object.freeze(destination.selectedToolIds),
          aliases: Object.freeze(destination.aliases),
        }),
      ),
  );
}

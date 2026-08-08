import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { asWriteConflict } from "../../errors/planlet-error.js";
import { tryStage } from "../git.js";
import { tryLstat } from "../paths.js";
import { sha256 } from "./skill-source.js";

/**
 * Single CLI-owned source for the agent onboarding snippet. Both `planlet
 * onboard` and the `init`/`update` agents-file writer render from here so the
 * printed snippet, the README quote, and any installed AGENTS.md/CLAUDE.md
 * section cannot drift apart by hand.
 */
export const AGENT_SNIPPET = `## Planning with Planlet

This repository uses Planlet for focused implementation plans. A planlet is
\`plans/<slug>/plan.md\` + \`tasks.md\`; Markdown is the source of truth.

- Propose a planlet before multi-step work; skip it for one-file changes.
- Drive it with the \`planlet\` CLI, never by hand-editing plan files:
  \`planlet create|show|tasks|status|validate <slug>\`,
  \`planlet task check <slug> <task-id>\`, \`planlet complete <slug>\`.
- Check each task off only after its verification passes. When the last task is
  checked, run \`planlet complete <slug>\` to archive it.
- Run \`planlet help [command]\` before using a command you have not used here.
- If no \`planlet\` executable is available, stop and say so. Do not hand-create
  or hand-edit planlet files.`;

const BEGIN_MARKER_PREFIX = "<!-- BEGIN PLANLET AGENTS";
const END_MARKER = "<!-- END PLANLET AGENTS -->";

export type AgentFileState =
  "added" | "updated" | "unchanged" | "skipped" | "left-alone";

export interface AgentFilesOutcome {
  readonly files: Readonly<Record<string, AgentFileState>>;
  readonly warnings: readonly string[];
  readonly changed: boolean;
}

/** @internal Fault-injection seam for deterministic failure tests. Tests only. */
export interface AgentFileDependencies {
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, content: string) => void;
}

const DEFAULT_DEPENDENCIES: AgentFileDependencies = {
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, content) =>
    writeFileSync(path, content, { encoding: "utf8" }),
};

function agentsSectionHash(): string {
  return sha256(Buffer.from(AGENT_SNIPPET, "utf8")).slice(0, 8);
}

export function renderAgentsSection(): string {
  return `${BEGIN_MARKER_PREFIX} v:1 hash:${agentsSectionHash()} -->\n${AGENT_SNIPPET}\n${END_MARKER}\n`;
}

/**
 * Updates the planlet-owned section in one file. Replace by marker when the
 * BEGIN marker is present and stale; append when absent; no-op when the hash
 * is fresh; leave the file untouched when our markers are malformed.
 */
function updateSection(
  content: string,
):
  | { readonly content: string; readonly state: "updated" | "unchanged" }
  | { readonly state: "left-alone"; readonly reason: string } {
  const beginIdx = content.indexOf(BEGIN_MARKER_PREFIX);
  if (beginIdx === -1) {
    const separator = content.endsWith("\n") ? "" : "\n";
    return {
      content: `${content}${separator}\n${renderAgentsSection()}`,
      state: "updated",
    };
  }

  const endIdx = content.indexOf(END_MARKER);
  if (endIdx === -1 || endIdx < beginIdx) {
    return {
      state: "left-alone",
      reason: `malformed planlet markers (BEGIN at offset ${beginIdx}, END ${endIdx === -1 ? "missing" : `at offset ${endIdx}`})`,
    };
  }

  const firstLine = content.slice(beginIdx).split("\n", 1)[0]!;
  const existingHash = /hash:([0-9a-f]+)/.exec(firstLine)?.[1];
  if (existingHash === agentsSectionHash()) {
    return { content, state: "unchanged" };
  }

  const endOfEnd = endIdx + END_MARKER.length;
  const tail = content.slice(endOfEnd);
  const consumed = tail.startsWith("\r\n")
    ? endOfEnd + 2
    : tail.startsWith("\n")
      ? endOfEnd + 1
      : endOfEnd;
  return {
    content:
      content.slice(0, beginIdx) +
      renderAgentsSection() +
      content.slice(consumed),
    state: "updated",
  };
}

function writeAgentFile(
  dependencies: AgentFileDependencies,
  path: string,
  file: string,
  content: string,
): void {
  try {
    dependencies.writeFile(path, content);
  } catch (error) {
    throw asWriteConflict(
      error,
      `Could not write agent instructions file: ${file}`,
      { file, operation: "write" },
    );
  }
}

/**
 * Updates one agents file. Init creates/updates; update refreshes present
 * planlet markers only. Non-regular paths (symlinks, directories) are never
 * followed or overwritten.
 */
function updateAgentFile(
  repositoryRoot: string,
  file: string,
  operation: "init" | "update",
  dependencies: AgentFileDependencies,
): { readonly state: AgentFileState; readonly warning?: string } {
  // Canonical root + lexical leaf path: resolveSafePath would follow a
  // symlinked leaf, but these files must never be written through symlinks.
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(repositoryRoot);
  } catch (error) {
    throw asWriteConflict(
      error,
      `Could not resolve repository root for agent instructions: ${repositoryRoot}`,
      { file, operation: "resolve" },
    );
  }
  const path = join(canonicalRoot, file);
  const stats = tryLstat(path);
  if (stats === null) {
    if (operation === "update" || file === "CLAUDE.md") {
      return { state: "skipped" };
    }
    writeAgentFile(dependencies, path, file, renderAgentsSection());
    return { state: "added" };
  }
  if (!stats.isFile()) {
    return {
      state: "skipped",
      warning: `${file} is not a regular file; skipped`,
    };
  }

  let content: string;
  try {
    content = dependencies.readFile(path);
  } catch (error) {
    throw asWriteConflict(
      error,
      `Could not read agent instructions file: ${file}`,
      { file, operation: "read" },
    );
  }
  if (operation === "update" && !content.includes(BEGIN_MARKER_PREFIX)) {
    return { state: "skipped" };
  }
  if (operation === "init" && file === "CLAUDE.md") {
    if (content.includes("@AGENTS.md")) return { state: "skipped" };
  }

  const outcome = updateSection(content);
  if (outcome.state === "left-alone") {
    return {
      state: "left-alone",
      warning: `${file}: ${outcome.reason}; left unchanged`,
    };
  }
  if (outcome.state === "updated") {
    writeAgentFile(dependencies, path, file, outcome.content);
  }
  return { state: outcome.state };
}

/**
 * Applies the agents-file side of init/update. Init writes AGENTS.md by
 * default and CLAUDE.md when that file is a real regular file that does not
 * already import AGENTS.md; update refreshes present planlet markers only.
 * `git add` stages each written file in git repositories; failures become
 * warnings.
 */
export function updateAgentFiles(options: {
  readonly repositoryRoot: string;
  readonly operation: "init" | "update";
  readonly skip?: boolean | undefined;
  /** @internal Fault-injection seam for deterministic failure tests. Tests only. */
  readonly dependencies?: Partial<AgentFileDependencies> | undefined;
}): AgentFilesOutcome {
  const files: Record<string, AgentFileState> = {};
  const warnings: string[] = [];
  let changed = false;
  const dependencies: AgentFileDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...options.dependencies,
  };

  for (const file of ["AGENTS.md", "CLAUDE.md"] as const) {
    if (options.skip === true) {
      files[file] = "skipped";
      continue;
    }
    const outcome = updateAgentFile(
      options.repositoryRoot,
      file,
      options.operation,
      dependencies,
    );
    files[file] = outcome.state;
    if (outcome.warning !== undefined) warnings.push(outcome.warning);
    if (outcome.state === "added" || outcome.state === "updated") {
      changed = true;
      tryStage(
        options.repositoryRoot,
        [join(options.repositoryRoot, file)],
        warnings,
        file,
      );
    }
  }

  return { files, warnings, changed };
}

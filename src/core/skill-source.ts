import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Dirent,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { PlanletError } from "../errors/planlet-error.js";
import { isPathWithinRoot } from "./paths.js";

export interface CanonicalSkillFile {
  readonly skill: string;
  readonly relativePath: string;
  readonly content: Buffer;
  readonly digest: string;
}

export interface CanonicalSkillSource {
  readonly skills: readonly string[];
  readonly files: readonly CanonicalSkillFile[];
}

export function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function directoryEntries(path: string): readonly Dirent[] {
  return readdirSync(path, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

function hasCanonicalSkills(path: string): boolean {
  try {
    return directoryEntries(path).some(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith("planlet-") &&
        lstatSync(join(path, entry.name, "SKILL.md")).isFile(),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new PlanletError(
      "write_conflict",
      `Cannot inspect canonical skill source: ${path}`,
      { details: { path }, cause: error },
    );
  }
}

export function resolveCanonicalSkillsPath(
  moduleUrl: string = import.meta.url,
): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    resolve(moduleDirectory, "../../skills"),
    resolve(moduleDirectory, "../skills"),
  ];
  for (const candidate of candidates) {
    if (hasCanonicalSkills(candidate)) return realpathSync(candidate);
  }

  throw new PlanletError(
    "write_conflict",
    "Canonical Planlet skills could not be located",
    { details: { candidates } },
  );
}

function enumerateDirectory(
  sourceRoot: string,
  skill: string,
  directory: string,
  files: CanonicalSkillFile[],
): void {
  for (const entry of directoryEntries(directory)) {
    const path = join(directory, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new PlanletError(
        "unsafe_path",
        `Canonical skill source contains a symbolic link: ${path}`,
        { details: { root: sourceRoot, path } },
      );
    }
    if (!isPathWithinRoot(sourceRoot, path)) {
      throw new PlanletError(
        "unsafe_path",
        `Canonical skill file escapes its source: ${path}`,
        { details: { root: sourceRoot, path } },
      );
    }
    if (stats.isDirectory()) {
      enumerateDirectory(sourceRoot, skill, path, files);
      continue;
    }
    if (!stats.isFile()) continue;

    const content = readFileSync(path);
    files.push({
      skill,
      relativePath: relative(sourceRoot, path).split(sep).join("/"),
      content,
      digest: sha256(content),
    });
  }
}

export function enumerateCanonicalSkills(
  sourceRoot: string = resolveCanonicalSkillsPath(),
): CanonicalSkillSource {
  let root: string;
  try {
    root = realpathSync(sourceRoot);
  } catch (error) {
    throw new PlanletError(
      "write_conflict",
      `Cannot resolve canonical skill source: ${sourceRoot}`,
      { details: { path: sourceRoot }, cause: error },
    );
  }

  let skills: string[];
  try {
    skills = directoryEntries(root)
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("planlet-"),
      )
      .map((entry) => entry.name);
  } catch (error) {
    throw new PlanletError(
      "write_conflict",
      `Cannot enumerate canonical skill source: ${root}`,
      { details: { path: root }, cause: error },
    );
  }
  if (skills.length === 0) {
    throw new PlanletError(
      "write_conflict",
      `Canonical skill source is empty: ${root}`,
      { details: { root } },
    );
  }

  const files: CanonicalSkillFile[] = [];
  for (const skill of skills) {
    enumerateDirectory(root, skill, join(root, skill), files);
  }
  for (const skill of skills) {
    if (!files.some((file) => file.relativePath === `${skill}/SKILL.md`)) {
      throw new PlanletError(
        "write_conflict",
        `Canonical skill is missing SKILL.md: ${skill}`,
        { details: { root, skill } },
      );
    }
  }

  return { skills, files };
}

import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PlanletError, asWriteConflict } from "../../errors/planlet-error.js";
import { pathKind, resolveSafePath } from "../paths.js";
import { INSTALLATION_MANIFEST } from "./harness-manifest.js";
import type { CanonicalSkillSource } from "./skill-source.js";

/**
 * Fault-injection seams for the publish transaction. Production never sets
 * hooks; they exist because the recovery paths below cannot be reached through
 * the public API otherwise. Three steps, one per distinct outcome: a throw at
 * `afterReplaceSkill` rolls back (and fires per skill, so a fault mid-loop
 * exercises a partial rollback), at `duringRollback` leaves recovery
 * directories, at `beforeCleanup` publishes but warns. Adding a step means a
 * new outcome, not a new place to throw.
 */
type InstallTxStep = "afterReplaceSkill" | "duringRollback" | "beforeCleanup";

export interface InstallTransactionHooks {
  readonly onStep?: (step: InstallTxStep, detail?: string) => void;
}

function writeSkillTree(
  stagingSkillPath: string,
  skill: string,
  source: CanonicalSkillSource,
): void {
  mkdirSync(stagingSkillPath);
  for (const file of source.files.filter((entry) => entry.skill === skill)) {
    const relativePath = file.relativePath.slice(skill.length + 1);
    const targetFile = resolveSafePath(
      stagingSkillPath,
      ...relativePath.split("/"),
    );
    mkdirSync(dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, file.content, { flag: "wx" });
  }
}

function moveManagedEntry(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(source, destination);
}

/**
 * Stages managed skills and the manifest, then swaps them into the live
 * destination. Failures before the manifest commit roll back to the exact
 * pre-operation managed state. After commit, cleanup is best-effort and never
 * rolls back published content. Unrelated non-Planlet skills are never touched.
 */
export function publishDestinationTransaction(
  destinationPath: string,
  source: CanonicalSkillSource,
  desiredManifestText: string,
  actualSkillNames: readonly string[],
  options: {
    readonly publishSkills: boolean;
    readonly writeManifest: boolean;
    readonly hooks?: InstallTransactionHooks;
  },
): readonly string[] {
  const hooks = options.hooks ?? {};
  const warnings: string[] = [];
  if (!options.publishSkills && !options.writeManifest) {
    return warnings;
  }

  const token = randomUUID();
  const stageRoot = join(destinationPath, `.planlet-tx-${token}`);
  const backupRoot = join(destinationPath, `.planlet-bak-${token}`);
  const desiredSkills = options.publishSkills ? [...source.skills] : [];
  const obsoleteSkills = options.publishSkills
    ? actualSkillNames.filter((skill) => !desiredSkills.includes(skill))
    : [];
  const liveManifest = join(destinationPath, INSTALLATION_MANIFEST);
  const mutated = new Set<string>();
  let backupReady = false;
  let committed = false;

  const emit = (step: InstallTxStep, detail?: string): void => {
    hooks.onStep?.(step, detail);
  };

  const rollback = (): void => {
    for (const name of [...mutated].reverse()) {
      emit("duringRollback", name);
      const live = join(destinationPath, name);
      const backup = join(backupRoot, name);
      rmSync(live, { recursive: true, force: true });
      if (pathKind(backup) !== "missing") {
        moveManagedEntry(backup, live);
      }
    }
  };

  try {
    mkdirSync(destinationPath, { recursive: true });
    mkdirSync(stageRoot);
    for (const skill of desiredSkills) {
      writeSkillTree(join(stageRoot, skill), skill, source);
    }
    if (options.writeManifest) {
      writeFileSync(
        join(stageRoot, INSTALLATION_MANIFEST),
        desiredManifestText,
        { encoding: "utf8", flag: "wx" },
      );
    }

    mkdirSync(backupRoot);
    backupReady = true;

    for (const skill of [...new Set([...desiredSkills, ...obsoleteSkills])]) {
      const live = resolveSafePath(destinationPath, skill);
      if (pathKind(live) === "missing") continue;
      moveManagedEntry(live, join(backupRoot, skill));
      mutated.add(skill);
    }
    if (options.writeManifest && pathKind(liveManifest) !== "missing") {
      moveManagedEntry(liveManifest, join(backupRoot, INSTALLATION_MANIFEST));
      mutated.add(INSTALLATION_MANIFEST);
    }

    for (const skill of desiredSkills) {
      moveManagedEntry(join(stageRoot, skill), join(destinationPath, skill));
      mutated.add(skill);
      emit("afterReplaceSkill", skill);
    }
    if (options.writeManifest) {
      moveManagedEntry(join(stageRoot, INSTALLATION_MANIFEST), liveManifest);
      mutated.add(INSTALLATION_MANIFEST);
    }

    // Commit point: live managed state is now the new installation.
    committed = true;
  } catch (error) {
    if (backupReady && !committed) {
      try {
        rollback();
      } catch (rollbackError) {
        // Never delete backupRoot on rollback failure; leave stage for recovery.
        throw new PlanletError(
          "write_conflict",
          `Could not roll back harness installation: ${destinationPath}`,
          {
            details: {
              destination: destinationPath,
              rollbackFailed: true,
              backupPath: backupRoot,
              stagePath: stageRoot,
              mutated: [...mutated],
              manifestPublished: false,
            },
            next: `Do not delete ${backupRoot} until managed files are restored from it. Leftover recovery dirs: ${backupRoot}, ${stageRoot}. Restore manually if needed, remove leftover .planlet-bak-* / .planlet-tx-* only when no install is running, then retry`,
            cause: new AggregateError([error, rollbackError]),
          },
        );
      }
    }
    try {
      rmSync(stageRoot, { recursive: true, force: true });
      if (!committed) rmSync(backupRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new PlanletError(
        "write_conflict",
        `Could not publish harness installation: ${destinationPath}`,
        {
          details: {
            destination: destinationPath,
            cleanupFailed: true,
            published: committed,
          },
          cause: new AggregateError([error, cleanupError]),
        },
      );
    }
    throw asWriteConflict(
      error,
      `Could not publish harness installation: ${destinationPath}`,
      { destination: destinationPath },
    );
  }

  try {
    emit("beforeCleanup");
    rmSync(stageRoot, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  } catch {
    warnings.push(
      `Harness installation published but cleanup was incomplete at ${destinationPath}`,
    );
  }

  return warnings;
}

import { installHarnessSkills } from "../core/harness/harness-installer.js";
import type { ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";
import type { HarnessCommandArguments } from "./init.js";

export function handleHarnessUpdate(
  arguments_: HarnessCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () =>
    installHarnessSkills({
      repositoryRoot: context.root,
      operation: "update",
      ...arguments_,
    }),
  ).exitCode;
}

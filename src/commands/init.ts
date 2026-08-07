import { installHarnessSkills } from "../core/harness/harness-installer.js";
import type { ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";

export interface HarnessCommandArguments {
  readonly tools?: string | undefined;
  readonly force?: boolean | undefined;
  readonly noAgents?: boolean | undefined;
}

export function handleHarnessInit(
  arguments_: HarnessCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () =>
    installHarnessSkills({
      repositoryRoot: context.root,
      operation: "init",
      ...arguments_,
    }),
  ).exitCode;
}

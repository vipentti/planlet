import { detectHarnesses } from "../core/harness/harness-installer.js";
import type { ExitCode } from "../errors/codes.js";
import { emit, type ExecutionContext } from "./shared.js";

export function handleTools(context: ExecutionContext): ExitCode {
  return emit(context, () => ({
    data: { tools: detectHarnesses({ repositoryRoot: context.root }) },
  })).exitCode;
}

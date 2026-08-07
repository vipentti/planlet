import type { ShowPart } from "../core/plan/read-only.js";
import { showPlanlet } from "../core/plan/read-only.js";
import type { ExitCode } from "../errors/codes.js";
import { compactShowContent } from "../output/toon.js";
import { emit, type ExecutionContext } from "./shared.js";

export interface ShowCommandArguments {
  readonly slug: string;
  readonly part?: ShowPart | undefined;
}

export function handleShow(
  arguments_: ShowCommandArguments,
  context: ExecutionContext,
): ExitCode {
  return emit(context, () => {
    // Warnings travel as diagnostics, not as part of the rendered payload.
    const { warnings, ...result } = showPlanlet({
      repositoryRoot: context.root,
      ...arguments_,
    });
    const data =
      context.full !== true && result.content !== undefined
        ? { ...result, content: compactShowContent(result.content) }
        : result;
    return {
      data,
      warnings,
    };
  }).exitCode;
}

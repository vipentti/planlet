import { AGENT_SNIPPET } from "../core/harness/agent-snippet.js";
import { EXIT_CODES, type ExitCode } from "../errors/codes.js";
import type { ExecutionContext } from "./shared.js";

export function handleOnboard(context: ExecutionContext): ExitCode {
  context.stdout(`${AGENT_SNIPPET}\n`);
  return EXIT_CODES.success;
}

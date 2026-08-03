import { main } from "./cli.js";
import { isPlanletError, PlanletError } from "./errors/planlet-error.js";
import { renderToonError } from "./output/toon.js";

export function renderUnexpectedError(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
): {
  readonly stderr: string;
  readonly exitCode: number;
} {
  if (isPlanletError(error)) {
    return renderToonError(error.toStructuredError());
  }

  const debug = env.PLANLET_DEBUG === "1";
  const details: Record<string, unknown> = {};
  if (debug) {
    if (error instanceof Error) {
      details.name = error.name;
      details.message = error.message;
      if (error.stack !== undefined) details.stack = error.stack;
    } else {
      details.value = String(error);
    }
  }

  return renderToonError(
    new PlanletError(
      "internal_error",
      "An unexpected internal error occurred",
      {
        details,
        ...(debug
          ? {}
          : { next: "Re-run with PLANLET_DEBUG=1 for diagnostic details" }),
      },
    ).toStructuredError(),
  );
}

export async function runProductionEntry(
  runMain: () => Promise<number> = main,
  env: NodeJS.ProcessEnv = process.env,
  writeStderr: (chunk: string) => void = (chunk) => {
    process.stderr.write(chunk);
  },
): Promise<number> {
  try {
    return await runMain();
  } catch (error) {
    const rendered = renderUnexpectedError(error, env);
    writeStderr(rendered.stderr);
    return rendered.exitCode;
  }
}

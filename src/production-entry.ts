import { main } from "./cli.js";
import { PlanletError } from "./errors/planlet-error.js";
import { renderToonError } from "./output/toon.js";

function debugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PLANLET_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function renderUnexpectedError(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
): {
  readonly stderr: string;
  readonly exitCode: number;
} {
  const details: Record<string, unknown> = {};
  if (debugEnabled(env)) {
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
        ...(debugEnabled(env)
          ? {}
          : {
              next: "Re-run with PLANLET_DEBUG=1 for diagnostic details",
            }),
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
    if (rendered.stderr.length > 0) {
      writeStderr(
        rendered.stderr.endsWith("\n")
          ? rendered.stderr
          : `${rendered.stderr}\n`,
      );
    }
    return rendered.exitCode;
  }
}

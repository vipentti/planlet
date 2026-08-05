import { encode } from "@toon-format/toon";

import {
  ERROR_EXIT_CODES,
  EXIT_CODES,
  type ExitCode,
} from "../errors/codes.js";
import type { StructuredError } from "../errors/planlet-error.js";

export const DEFAULT_MAX_STRING_CHARACTERS = 4_096;

export interface RenderedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: ExitCode;
}

interface CompactShowContent {
  readonly preview: string;
  readonly truncated: true;
  readonly originalCharacters: number;
  readonly shownCharacters: number;
  readonly hint: "Re-run with --full for complete content";
}

/** Compact a show content field, returning the raw string when it fits. */
export function compactShowContent(
  value: string,
  maximum: number = DEFAULT_MAX_STRING_CHARACTERS,
): CompactShowContent | string {
  const characters = Array.from(value);
  if (characters.length <= maximum) {
    return value;
  }

  return {
    preview: `${characters.slice(0, maximum).join("")}…`,
    truncated: true,
    originalCharacters: characters.length,
    shownCharacters: maximum,
    hint: "Re-run with --full for complete content",
  };
}

function withTrailingNewline(value: unknown): string {
  return `${encode(value)}\n`;
}

export function renderToonError(error: StructuredError): RenderedOutput {
  const { code, message, details, next } = error;
  const contextualDetails = Object.fromEntries(
    Object.entries(details).filter(
      ([key]) => key !== "code" && key !== "message" && key !== "next",
    ),
  );
  return {
    stdout: "",
    stderr: withTrailingNewline({
      error: { code, message, ...contextualDetails },
      ...(next === undefined ? {} : { next }),
    }),
    exitCode: ERROR_EXIT_CODES[code],
  };
}

/** Serialize one command result without touching process I/O. */
export function renderToon(
  data: unknown,
  warnings: readonly string[] = [],
): RenderedOutput {
  return {
    stdout: withTrailingNewline(data),
    stderr:
      warnings.length === 0
        ? ""
        : withTrailingNewline({
            diagnostics: warnings.map((message) => ({
              level: "warning",
              message,
            })),
          }),
    exitCode: EXIT_CODES.success,
  };
}

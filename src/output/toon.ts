import { encode } from "@toon-format/toon";

import {
  EXIT_CODES,
  exitCodeForError,
  type ExitCode,
} from "../errors/codes.js";
import type { FailedResult, StructuredResult } from "./model.js";

export const DEFAULT_MAX_STRING_CHARACTERS = 4_096;

export interface ToonRenderOptions {
  /** Disable the normal compact-content limit. */
  readonly full?: boolean;
  /** Primarily injectable so the truncation boundary can be tested cheaply. */
  readonly maxStringCharacters?: number;
}

export interface RenderedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: ExitCode;
}

interface TruncatedString {
  readonly preview: string;
  readonly truncated: true;
  readonly originalCharacters: number;
  readonly shownCharacters: number;
  readonly hint: "Re-run with --full for complete content";
}

function truncatedString(
  value: string,
  maximum: number,
): TruncatedString | string {
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

function truncateLargeStrings(value: unknown, maximum: number): unknown {
  if (typeof value === "string") {
    return truncatedString(value, maximum);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => truncateLargeStrings(entry, maximum));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        truncateLargeStrings(entry, maximum),
      ]),
    );
  }
  return value;
}

function withTrailingNewline(value: unknown): string {
  return `${encode(value)}\n`;
}

function renderFailure(result: FailedResult): RenderedOutput {
  const { code, message, details, next } = result.error;
  const contextualDetails = Object.fromEntries(
    Object.entries(details).filter(
      ([key]) => key !== "code" && key !== "message" && key !== "next",
    ),
  );
  const diagnostic = {
    error: { code, message, ...contextualDetails },
    ...(next === undefined ? {} : { next }),
    ...(result.diagnostics.length === 0
      ? {}
      : { diagnostics: result.diagnostics }),
  };
  return Object.freeze({
    stdout: "",
    stderr: withTrailingNewline(diagnostic),
    exitCode: exitCodeForError(result.error.code),
  });
}

/** Serialize one command result without touching process I/O. */
export function renderToon(
  result: StructuredResult,
  options: ToonRenderOptions = {},
): RenderedOutput {
  if (!result.ok) {
    return renderFailure(result);
  }

  const maximum = options.maxStringCharacters ?? DEFAULT_MAX_STRING_CHARACTERS;
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RangeError("maxStringCharacters must be a positive safe integer");
  }

  const data =
    options.full === true
      ? result.data
      : truncateLargeStrings(result.data, maximum);
  return Object.freeze({
    stdout: withTrailingNewline(data),
    stderr:
      result.diagnostics.length === 0
        ? ""
        : withTrailingNewline({ diagnostics: result.diagnostics }),
    exitCode: EXIT_CODES.success,
  });
}

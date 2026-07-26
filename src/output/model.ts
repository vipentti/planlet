import type { StructuredError } from "../errors/planlet-error.js";

export interface OutputDiagnostic {
  readonly level: "warning";
  readonly message: string;
}

export interface SuccessfulResult<T = unknown> {
  readonly ok: true;
  readonly data: T;
  readonly diagnostics: readonly OutputDiagnostic[];
}

export interface FailedResult {
  readonly ok: false;
  readonly error: StructuredError;
  readonly diagnostics: readonly OutputDiagnostic[];
}

/**
 * Renderer-independent result consumed by the default TOON renderer and future
 * JSON, human, and quiet renderers.
 */
export type StructuredResult<T = unknown> = SuccessfulResult<T> | FailedResult;

export function warningsAsDiagnostics(
  warnings: readonly string[],
): readonly OutputDiagnostic[] {
  return warnings.map((message) => ({ level: "warning" as const, message }));
}

export function successfulResult<T>(
  data: T,
  warnings: readonly string[] = [],
): SuccessfulResult<T> {
  return { ok: true, data, diagnostics: warningsAsDiagnostics(warnings) };
}

export function failedResult(error: StructuredError): FailedResult {
  return { ok: false, error, diagnostics: [] };
}

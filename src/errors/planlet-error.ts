import type { ErrorCode } from "./codes.js";

export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface StructuredError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: ErrorDetails;
  readonly next?: string;
}

export interface PlanletErrorOptions {
  readonly details?: ErrorDetails;
  readonly next?: string;
  readonly cause?: unknown;
}

export class PlanletError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;
  readonly next: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: PlanletErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : {
            cause: options.cause,
          },
    );
    this.name = "PlanletError";
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.next = options.next;
  }

  toStructuredError(): StructuredError {
    const result: StructuredError = {
      code: this.code,
      message: this.message,
      details: this.details,
    };

    if (this.next === undefined) {
      return result;
    }

    return { ...result, next: this.next };
  }
}

export function isPlanletError(error: unknown): error is PlanletError {
  return error instanceof PlanletError;
}

export function asWriteConflict(
  error: unknown,
  message: string,
  details: ErrorDetails = {},
): PlanletError {
  if (isPlanletError(error)) {
    return error;
  }
  return new PlanletError("write_conflict", message, {
    details,
    cause: error,
  });
}

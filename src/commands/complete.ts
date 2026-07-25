import {
  completePlanlet,
  type CompletePlanletDependencies,
  type CompletePlanletResult,
} from "../core/planlet-completion.js";

export interface CompleteCommandOptions {
  readonly repositoryRoot: string;
  readonly slug: string;
  readonly allowIncomplete?: boolean;
  readonly reason?: string;
  readonly dependencies?: Partial<CompletePlanletDependencies>;
}

export function complete(
  options: CompleteCommandOptions,
): CompletePlanletResult {
  return completePlanlet(options);
}

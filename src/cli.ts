import { resolve } from "node:path";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import {
  handleComplete,
  handleCreate,
  handleDashboard,
  handleList,
  handleShow,
  handleStatus,
  handleTasks,
  handleTaskUpdate,
  handleValidate,
  type ExecutionContext,
} from "./commands/handlers.js";
import { PLANLET_STATES, type PlanletState } from "./core/models.js";
import { discoverRepositoryRoot } from "./core/repository.js";
import { EXIT_CODES, type ExitCode } from "./errors/codes.js";
import { isPlanletError } from "./errors/planlet-error.js";
import { failedResult } from "./output/model.js";
import { renderToon } from "./output/toon.js";

const HELP = `Usage: planlet [--root <path>] [--full] <command> [options]

Commands:
  list [--state <state>] [--completed]
  create <slug> [--title <title>]
  show <slug> [--part plan|tasks|summary]
  status <slug>
  validate [<slug>|--all]
  tasks <slug> [--remaining|--completed]
  task check|uncheck <slug> <task-id>
  complete <slug> [--allow-incomplete --reason <text>]
  help [command]

Running planlet without a command displays the active-plan dashboard.
`;

const COMMAND_HELP: Readonly<Record<string, string>> = Object.freeze({
  list: "Usage: planlet list [--state <state>] [--completed]\n",
  create: "Usage: planlet create <slug> [--title <title>]\n",
  show: "Usage: planlet show <slug> [--part plan|tasks|summary]\n",
  status: "Usage: planlet status <slug>\n",
  validate: "Usage: planlet validate [<slug>|--all]\n",
  tasks: "Usage: planlet tasks <slug> [--remaining|--completed]\n",
  task: "Usage: planlet task check|uncheck <slug> <task-id>\n",
  complete:
    "Usage: planlet complete <slug> [--allow-incomplete --reason <text>]\n",
});

export interface CliRuntime {
  readonly cwd: string;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly clock: () => Date;
}

interface GlobalArguments {
  readonly arguments: readonly string[];
  readonly explicitRoot?: string;
  readonly full: boolean;
}

class UsageError extends Error {}

const PARSE_ARGS_ERROR_CODES = new Set([
  "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
  "ERR_PARSE_ARGS_UNKNOWN_OPTION",
]);

function isParseArgsError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    PARSE_ARGS_ERROR_CODES.has(error.code)
  );
}

function usage(message: string): never {
  throw new UsageError(message);
}

function extractGlobalArguments(
  arguments_: readonly string[],
): GlobalArguments {
  const remaining: string[] = [];
  let explicitRoot: string | undefined;
  let full = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--root") {
      if (explicitRoot !== undefined) usage("--root may only be supplied once");
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        usage("--root requires a path");
      }
      explicitRoot = value;
      index += 1;
    } else if (argument?.startsWith("--root=")) {
      if (explicitRoot !== undefined) usage("--root may only be supplied once");
      explicitRoot = argument.slice("--root=".length);
      if (explicitRoot.length === 0) usage("--root requires a path");
    } else if (argument === "--full") {
      full = true;
    } else if (argument !== undefined) {
      remaining.push(argument);
    }
  }

  return {
    arguments: remaining,
    ...(explicitRoot === undefined ? {} : { explicitRoot }),
    full,
  };
}

function parse<const Options extends ParseArgsOptionsConfig>(
  arguments_: readonly string[],
  options: Options,
) {
  return parseArgs({
    args: [...arguments_],
    options,
    allowPositionals: true,
  } as const);
}

function requirePositionals(
  positionals: readonly string[],
  count: number,
  command: string,
): void {
  if (positionals.length !== count) {
    usage(COMMAND_HELP[command]?.trimEnd() ?? `Invalid ${command} arguments`);
  }
}

function helpFor(command: string | undefined): string {
  if (command === undefined) return HELP;
  const commandHelp = COMMAND_HELP[command];
  if (commandHelp === undefined) usage(`Unknown command: ${command}`);
  return commandHelp;
}

type PreparedCommand = (context: ExecutionContext) => ExitCode;

function prepareCommand(
  command: string,
  arguments_: readonly string[],
): PreparedCommand {
  // `--help` is intercepted by `main` before this point.
  switch (command) {
    case "list": {
      const { values, positionals } = parse(arguments_, {
        state: { type: "string" },
        completed: { type: "boolean" },
      });
      requirePositionals(positionals, 0, command);
      const state = values.state;
      if (
        state !== undefined &&
        !PLANLET_STATES.includes(state as PlanletState)
      ) {
        usage(`Unknown planlet state: ${state}`);
      }
      const commandArguments = {
        ...(state === undefined ? {} : { state: state as PlanletState }),
        ...(values.completed === undefined
          ? {}
          : { completed: values.completed }),
      };
      return (context) => handleList(commandArguments, context);
    }
    case "create": {
      const { values, positionals } = parse(arguments_, {
        title: { type: "string" },
      });
      requirePositionals(positionals, 1, command);
      const commandArguments = {
        slug: positionals[0]!,
        ...(values.title === undefined ? {} : { title: values.title }),
      };
      return (context) => handleCreate(commandArguments, context);
    }
    case "show": {
      const { values, positionals } = parse(arguments_, {
        part: { type: "string" },
      });
      requirePositionals(positionals, 1, command);
      if (
        values.part !== undefined &&
        !["plan", "tasks", "summary"].includes(values.part)
      ) {
        usage(`Unknown show part: ${values.part}`);
      }
      const commandArguments = {
        slug: positionals[0]!,
        ...(values.part === undefined
          ? {}
          : { part: values.part as "plan" | "tasks" | "summary" }),
      };
      return (context) => handleShow(commandArguments, context);
    }
    case "status": {
      const { positionals } = parse(arguments_, {});
      requirePositionals(positionals, 1, command);
      const commandArguments = { slug: positionals[0]! };
      return (context) => handleStatus(commandArguments, context);
    }
    case "validate": {
      const { values, positionals } = parse(arguments_, {
        all: { type: "boolean" },
      });
      if (positionals.length > 1 || (positionals.length === 1 && values.all)) {
        usage(COMMAND_HELP.validate!.trimEnd());
      }
      const commandArguments = {
        ...(positionals[0] === undefined ? {} : { slug: positionals[0] }),
        ...(values.all === undefined ? {} : { all: values.all }),
      };
      return (context) => handleValidate(commandArguments, context);
    }
    case "tasks": {
      const { values, positionals } = parse(arguments_, {
        remaining: { type: "boolean" },
        completed: { type: "boolean" },
      });
      requirePositionals(positionals, 1, command);
      if (values.remaining && values.completed) {
        usage("--remaining and --completed are mutually exclusive");
      }
      const commandArguments = {
        slug: positionals[0]!,
        ...(values.remaining === undefined
          ? {}
          : { remaining: values.remaining }),
        ...(values.completed === undefined
          ? {}
          : { completed: values.completed }),
      };
      return (context) => handleTasks(commandArguments, context);
    }
    case "task": {
      const { positionals } = parse(arguments_, {});
      requirePositionals(positionals, 3, command);
      const operation = positionals[0];
      if (operation !== "check" && operation !== "uncheck") {
        usage(COMMAND_HELP.task!.trimEnd());
      }
      const commandArguments = {
        operation: operation as "check" | "uncheck",
        slug: positionals[1]!,
        taskId: positionals[2]!,
      };
      return (context) => handleTaskUpdate(commandArguments, context);
    }
    case "complete": {
      const { values, positionals } = parse(arguments_, {
        "allow-incomplete": { type: "boolean" },
        reason: { type: "string" },
      });
      requirePositionals(positionals, 1, command);
      if (values.reason !== undefined && !values["allow-incomplete"]) {
        usage("--reason requires --allow-incomplete");
      }
      const commandArguments = {
        slug: positionals[0]!,
        ...(values["allow-incomplete"] === undefined
          ? {}
          : { allowIncomplete: values["allow-incomplete"] }),
        ...(values.reason === undefined ? {} : { reason: values.reason }),
      };
      return (context) => handleComplete(commandArguments, context);
    }
    default:
      usage(`Unknown command: ${command}`);
  }
}

/**
 * Parse and dispatch one command against an already selected repository root.
 * `main` intercepts `--help` before repository discovery; this entry point is
 * reachable on its own, so it repeats that interception here.
 */
export function dispatchCommand(
  command: string,
  arguments_: readonly string[],
  context: ExecutionContext,
): ExitCode {
  if (arguments_.includes("--help")) {
    context.stdout(helpFor(command));
    return EXIT_CODES.success;
  }
  return prepareCommand(command, arguments_)(context);
}

function writeUsage(runtime: CliRuntime, message: string): ExitCode {
  runtime.stderr(
    `usage: ${message}\nRun 'planlet help' for command reference.\n`,
  );
  return EXIT_CODES.usage;
}

/** Process-independent CLI entry point with injectable argv, I/O, cwd, and clock. */
export function main(
  arguments_: readonly string[] = process.argv.slice(2),
  runtimeOverrides: Partial<CliRuntime> = {},
): ExitCode {
  const runtime: CliRuntime = {
    cwd: runtimeOverrides.cwd ?? process.cwd(),
    stdout: runtimeOverrides.stdout ?? ((value) => process.stdout.write(value)),
    stderr: runtimeOverrides.stderr ?? ((value) => process.stderr.write(value)),
    clock: runtimeOverrides.clock ?? (() => new Date()),
  };

  try {
    const global = extractGlobalArguments(arguments_);
    const [command, ...commandArguments] = global.arguments;
    if (command === "help" || command === "--help") {
      runtime.stdout(helpFor(commandArguments[0]));
      return EXIT_CODES.success;
    }
    if (command !== undefined && commandArguments.includes("--help")) {
      runtime.stdout(helpFor(command));
      return EXIT_CODES.success;
    }

    // Parse all command-specific usage before repository-dependent work.
    const preparedCommand =
      command === undefined
        ? undefined
        : prepareCommand(command, commandArguments);

    const explicitRoot =
      global.explicitRoot === undefined
        ? undefined
        : resolve(runtime.cwd, global.explicitRoot);
    const root = discoverRepositoryRoot({
      startPath: runtime.cwd,
      ...(explicitRoot === undefined ? {} : { explicitRoot }),
      ...(command === "create" ? { allowUnmarkedStart: true } : {}),
    });
    const context: ExecutionContext = {
      root,
      stdout: runtime.stdout,
      stderr: runtime.stderr,
      clock: runtime.clock,
      ...(global.full ? { full: true } : {}),
    };

    return preparedCommand === undefined
      ? handleDashboard(context)
      : preparedCommand(context);
  } catch (error) {
    // This boundary translates only intentional usage failures and stable
    // util.parseArgs input-error codes. Unexpected TypeErrors must propagate.
    if (error instanceof UsageError || isParseArgsError(error)) {
      return writeUsage(runtime, error.message);
    }
    if (isPlanletError(error)) {
      const rendered = renderToon(failedResult(error.toStructuredError()));
      runtime.stderr(rendered.stderr);
      return rendered.exitCode;
    }
    throw error;
  }
}

import { resolve } from "node:path";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import {
  handleComplete,
  handleHarnessInit,
  handleHarnessUpdate,
  handleTools,
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
import { renderToonError } from "./output/toon.js";

const HELP = `Usage: planlet [--root <path>] [--full] <command> [options]

Commands:
  init [--tools <ids>] [--force]
  update [--tools <ids>] [--force]
  tools
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

const COMMAND_HELP: Readonly<Record<string, string>> = {
  init: "Usage: planlet init [--tools <ids>] [--force]\n",
  update: "Usage: planlet update [--tools <ids>] [--force]\n",
  tools: "Usage: planlet tools\n",
  list: "Usage: planlet list [--state <state>] [--completed]\n",
  create: "Usage: planlet create <slug> [--title <title>]\n",
  show: "Usage: planlet show <slug> [--part plan|tasks|summary]\n",
  status: "Usage: planlet status <slug>\n",
  validate: "Usage: planlet validate [<slug>|--all]\n",
  tasks: "Usage: planlet tasks <slug> [--remaining|--completed]\n",
  task: "Usage: planlet task check|uncheck <slug> <task-id>\n",
  complete:
    "Usage: planlet complete <slug> [--allow-incomplete --reason <text>]\n",
};

export interface CliRuntime {
  readonly cwd: string;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly clock: () => Date;
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

function prepareCommand(
  command: string,
  arguments_: readonly string[],
): (context: ExecutionContext) => ExitCode {
  switch (command) {
    case "init":
    case "update": {
      const { values, positionals } = parse(arguments_, {
        tools: { type: "string" },
        force: { type: "boolean" },
      });
      requirePositionals(positionals, 0, command);
      const commandArguments = { tools: values.tools, force: values.force };
      return command === "init"
        ? (context) => handleHarnessInit(commandArguments, context)
        : (context) => handleHarnessUpdate(commandArguments, context);
    }
    case "tools": {
      const { positionals } = parse(arguments_, {});
      requirePositionals(positionals, 0, command);
      return (context) => handleTools(context);
    }
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
        state: state as PlanletState | undefined,
        completed: values.completed,
      };
      return (context) => handleList(commandArguments, context);
    }
    case "create": {
      const { values, positionals } = parse(arguments_, {
        title: { type: "string" },
      });
      requirePositionals(positionals, 1, command);
      const commandArguments = { slug: positionals[0]!, title: values.title };
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
        part: values.part as "plan" | "tasks" | "summary" | undefined,
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
      const commandArguments = { slug: positionals[0], all: values.all };
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
        remaining: values.remaining,
        completed: values.completed,
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
        allowIncomplete: values["allow-incomplete"],
        reason: values.reason,
      };
      return (context) => handleComplete(commandArguments, context);
    }
    default:
      usage(`Unknown command: ${command}`);
  }
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
    const globalOptions = {
      root: { type: "string" },
      full: { type: "boolean" },
      help: { type: "boolean" },
    } as const;
    const loose = parseArgs({
      args: [...arguments_],
      options: globalOptions,
      allowPositionals: true,
      strict: false,
      tokens: true,
    });
    const commandToken = loose.tokens.find(
      (token) => token.kind === "positional",
    );
    const commandIndex = commandToken?.index ?? arguments_.length;
    const { values: global, positionals: globalPositionals } = parse(
      arguments_.slice(0, commandIndex),
      globalOptions,
    );
    requirePositionals(globalPositionals, 0, "global");
    const command = commandToken?.value;
    const commandArguments = arguments_.slice(commandIndex + 1);
    if (
      global.help ||
      (command !== undefined &&
        commandArguments.length === 1 &&
        commandArguments[0] === "--help")
    ) {
      runtime.stdout(helpFor(command));
      return EXIT_CODES.success;
    }
    if (command === "help" || command === "--help") {
      runtime.stdout(helpFor(commandArguments[0]));
      return EXIT_CODES.success;
    }

    const preparedCommand =
      command === undefined
        ? undefined
        : prepareCommand(command, commandArguments);

    const explicitRoot =
      global.root === undefined ? undefined : resolve(runtime.cwd, global.root);
    const root = discoverRepositoryRoot({
      startPath: runtime.cwd,
      explicitRoot,
      allowUnmarkedStart: command === "create" || command === "init",
    });
    const context: ExecutionContext = {
      root,
      stdout: runtime.stdout,
      stderr: runtime.stderr,
      clock: runtime.clock,
      full: global.full,
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
      const rendered = renderToonError(error.toStructuredError());
      runtime.stderr(rendered.stderr);
      return rendered.exitCode;
    }
    throw error;
  }
}

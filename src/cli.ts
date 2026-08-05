import { once } from "node:events";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import {
  handleComplete,
  handleHarnessInit,
  handleHarnessUpdate,
  handleTools,
  handleCreate,
  handleDashboard,
  handleList,
  handleOnboard,
  handleShow,
  handleStatus,
  handleTasks,
  handleTaskUpdate,
  handleValidate,
  type ExecutionContext,
} from "./commands/handlers.js";
import { detectHarnesses } from "./core/harness-installer.js";
import {
  normalizeToolSelector,
  resolveHarnessDestinations,
} from "./core/harnesses.js";
import { PLANLET_STATES, type PlanletState } from "./core/models.js";
import { errnoIs } from "./core/paths.js";
import { discoverRepositoryRoot } from "./core/repository.js";
import { EXIT_CODES, type ExitCode } from "./errors/codes.js";
import { isPlanletError } from "./errors/planlet-error.js";
import { renderToonError } from "./output/toon.js";

// Both src/cli.ts under tsx and the bundled dist/planlet.mjs sit one directory
// below package.json, so one relative require works without a build-time define.
const VERSION = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

const COMMAND_HELP: Readonly<Record<string, string>> = {
  init:
    "Usage: planlet init [--tools <ids>] [--force] [--no-agents]\n\n" +
    "--tools takes all, none, or comma-separated agents, claude, codex, github-copilot.\n" +
    "Without it, an interactive terminal is asked which destinations to\n" +
    "install; anything else installs all of them.\n" +
    "--no-agents skips writing the onboarding section to AGENTS.md and CLAUDE.md.\n",
  update:
    "Usage: planlet update [--tools <ids>] [--force]\n\n" +
    "--tools takes all, none, or comma-separated agents, claude, codex, github-copilot.\n",
  tools: "Usage: planlet tools\n",
  onboard: "Usage: planlet onboard\n",
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

function renderHelp(): string {
  const commands = [
    ...Object.entries(COMMAND_HELP).map(
      ([, help]) => `  ${help.split("\n")[0]!.slice("Usage: planlet ".length)}`,
    ),
    "  help [command]",
  ].join("\n");

  return `Usage: planlet [--root <path>] [--full] [--version] <command> [options]

Commands:
${commands}

Global options:
  --version   Print the Planlet version and exit.
  --full      Return complete show --part plan|tasks content.

Running planlet without a command displays the active-plan dashboard.
`;
}

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
  if (command === undefined) return renderHelp();
  const commandHelp = COMMAND_HELP[command];
  if (commandHelp === undefined) usage(`Unknown command: ${command}`);
  return commandHelp;
}

export interface ToolChoice {
  readonly selector: string;
  readonly destination: string;
  readonly names: string;
  readonly state: string;
  readonly preselected: boolean;
}

function hasEntries(path: string): boolean {
  try {
    return readdirSync(path).length > 0;
  } catch (error) {
    // A missing directory has nothing in it, and a non-directory is reported as
    // a modified destination that the installer rejects with write_conflict.
    if (errnoIs(error, "ENOENT", "ENOTDIR")) {
      return false;
    }
    throw error;
  }
}

/**
 * One choice per resolved destination directory, so the `.agents/skills`
 * directory that the agents and codex adapters share is offered once under both
 * names.
 */
export function buildToolChoices(
  repositoryRoot: string,
): readonly ToolChoice[] {
  const detected = new Map(
    detectHarnesses({ repositoryRoot }).map((harness) => [harness.id, harness]),
  );
  const choices = resolveHarnessDestinations(
    repositoryRoot,
    normalizeToolSelector("all"),
  ).map((destination) => ({
    selector: destination.aliases.join(","),
    destination: destination.relativePath,
    names: destination.aliases.map((id) => detected.get(id)!.name).join(", "),
    state: detected.get(destination.aliases[0]!)!.state,
    // Any existing content counts, including unrelated skills: the directory
    // existing at all is the signal that this harness is in use here.
    preselected: hasEntries(destination.path),
  }));
  return choices.some((choice) => choice.preselected)
    ? choices
    : choices.map((choice) => ({ ...choice, preselected: true }));
}

/**
 * Maps one prompt answer to a `--tools` selector, or to `undefined` when the
 * answer is unrecognized and the prompt should be repeated. Repeated numbers
 * are harmless: the selector is deduplicated when it is normalized.
 */
export function resolveAnswer(
  choices: readonly ToolChoice[],
  answer: string,
): string | undefined {
  const trimmed = answer.trim();
  if (trimmed === "") {
    return choices
      .filter((choice) => choice.preselected)
      .map((choice) => choice.selector)
      .join(",");
  }
  if (trimmed.toLowerCase() === "none") return "none";

  const numbers = trimmed.split(",").map((value) => Number(value.trim()));
  const valid = numbers.every(
    (number) =>
      Number.isInteger(number) && number >= 1 && number <= choices.length,
  );
  return valid
    ? numbers.map((number) => choices[number - 1]!.selector).join(",")
    : undefined;
}

/**
 * Asks which destinations to install to, resolving to a `--tools` selector or
 * to `undefined` when the user cancels with Ctrl-C or EOF. Reads the real TTY
 * because the caller only reaches this when both stdin and stdout are TTYs.
 */
async function selectToolsInteractively(
  repositoryRoot: string,
): Promise<string | undefined> {
  const choices = buildToolChoices(repositoryRoot);
  const defaults = choices.flatMap((choice, index) =>
    choice.preselected ? [index + 1] : [],
  );
  const interface_ = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // Without this, readline re-raises SIGINT and kills the process instead of
  // letting the caller treat Ctrl-C as a cancellation that writes nothing.
  interface_.on("SIGINT", () => interface_.close());
  const cancelled = once(interface_, "close").then(() => undefined);

  try {
    process.stdout.write(
      `Install Planlet skills to:\n${choices
        .map(
          (choice, index) =>
            `  ${index + 1}) ${choice.destination}   ${choice.names}  [${choice.state}]`,
        )
        .join("\n")}\n`,
    );
    for (;;) {
      // A pending question never settles when stdin ends or Ctrl-C closes the
      // interface, so the close event is what turns that into a cancellation.
      const answer = await Promise.race([
        interface_
          .question(
            `Enter numbers, comma-separated, or 'none' [${defaults.join(",")}]: `,
          )
          // Closing the interface can also reject the pending question instead
          // of leaving it unsettled, which is the same cancellation.
          .catch((error: unknown) => {
            if (error instanceof Error && error.name === "AbortError") {
              return undefined;
            }
            throw error;
          }),
        cancelled,
      ]);
      if (answer === undefined) {
        process.stdout.write("\n");
        return undefined;
      }

      const selector = resolveAnswer(choices, answer);
      if (selector !== undefined) return selector;
      process.stdout.write("Unrecognized selection.\n");
    }
  } finally {
    interface_.close();
  }
}

function prepareCommand(
  command: string,
  arguments_: readonly string[],
): (context: ExecutionContext) => ExitCode | Promise<ExitCode> {
  switch (command) {
    case "init":
    case "update": {
      const { values, positionals } = parse(arguments_, {
        tools: { type: "string" },
        force: { type: "boolean" },
        ...(command === "init" ? { "no-agents": { type: "boolean" } } : {}),
      });
      requirePositionals(positionals, 0, command);
      const commandArguments = {
        tools: values.tools,
        force: values.force,
        noAgents: values["no-agents"] === true,
      };
      // An explicit --tools, a pipe, or a redirect keeps init non-interactive.
      const interactive =
        values.tools === undefined &&
        process.stdin.isTTY === true &&
        process.stdout.isTTY === true;
      if (command === "update") {
        return (context) => handleHarnessUpdate(commandArguments, context);
      }
      return async (context) => {
        if (!interactive) return handleHarnessInit(commandArguments, context);
        const tools = await selectToolsInteractively(context.root);
        if (tools === undefined) return EXIT_CODES.usage;
        return handleHarnessInit({ ...commandArguments, tools }, context);
      };
    }
    case "onboard": {
      const { positionals } = parse(arguments_, {});
      requirePositionals(positionals, 0, command);
      return (context) => handleOnboard(context);
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
export async function main(
  arguments_: readonly string[] = process.argv.slice(2),
  runtimeOverrides: Partial<CliRuntime> = {},
): Promise<ExitCode> {
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
      version: { type: "boolean" },
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
    if (global.version) {
      runtime.stdout(`${VERSION}\n`);
      return EXIT_CODES.success;
    }
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

    if (command === "onboard") {
      // Repo-independent, read-only: print before repository discovery so the
      // snippet is available from any directory, including unmarked ones.
      const preparedCommand = prepareCommand("onboard", commandArguments);
      return preparedCommand({
        root: runtime.cwd,
        stdout: runtime.stdout,
        stderr: runtime.stderr,
        clock: runtime.clock,
      });
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

    // Awaited inside the try so asynchronous rejections still reach the
    // structured-error translation below.
    return preparedCommand === undefined
      ? handleDashboard(context)
      : await preparedCommand(context);
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

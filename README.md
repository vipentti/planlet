# Planlet

Small plans. Clear handoffs.

Planlet is a repository-local planning and task-management utility for AI coding
agents and human reviewers. A planlet is a focused implementation plan stored as
two Markdown files:

```text
plans/<slug>/
├── plan.md
└── tasks.md
```

Markdown is the source of truth. The CLI provides deterministic discovery,
validation, progress, and lifecycle operations; the bundled agent skills provide
the investigation and judgment around them.

## Installation

Planlet requires Node.js 22 or newer.

```sh
npm install -g planlet
```

Or run it without installing:

```sh
npx planlet <command>
```

## Quickstart

```sh
cd your-repository
planlet init                 # create plans/ and install the agent skills
planlet create my-feature    # scaffold plans/my-feature/{plan.md,tasks.md}
# edit plan.md and tasks.md
planlet validate my-feature
planlet tasks my-feature
planlet task check my-feature T1
planlet status my-feature
planlet complete my-feature  # archive to plans/completed/<date>-my-feature/
```

Running `planlet` with no command displays the active-plan dashboard.

## Commands

| Command                                                | Purpose                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `init [--tools <ids>] [--force]`                       | Create `plans/` and install harness skill copies      |
| `update [--tools <ids>] [--force]`                     | Refresh installed skill copies from canonical sources |
| `tools`                                                | Report skill destinations and installation state      |
| `list [--state <state>] [--completed]`                 | List planlets                                         |
| `create <slug> [--title <title>]`                      | Scaffold a new planlet                                |
| `show <slug> [--part plan\|tasks\|summary]`            | Show planlet content                                  |
| `status <slug>`                                        | Report state and task counts                          |
| `validate [<slug>\|--all]`                             | Validate planlet structure                            |
| `tasks <slug> [--remaining\|--completed]`              | List tasks                                            |
| `task check\|uncheck <slug> <task-id>`                 | Toggle a task checkbox                                |
| `complete <slug> [--allow-incomplete --reason <text>]` | Archive a planlet under `plans/completed/`            |
| `help [command]`                                       | Show usage                                            |

Global options: `--root <path>` selects the repository root, `--full` disables
output truncation, and `--version` prints the version and exits.

## Harness installation

Canonical workflows live under `skills/planlet-*`. Install project-local
copies with `planlet init`, refresh existing copies with `planlet update`, and
inspect installation state without mutation with `planlet tools`.

`--tools` accepts comma-separated `agents`, `claude`, and `codex` IDs.
`agents` and `codex` share `.agents/skills`; `claude` uses `.claude/skills`.
Omitting `--tools` selects all adapters. `planlet init --tools none` creates
only `plans/`. Locally modified generated files require explicit `--force`
before replacement.

## Development

| Command                 | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `npm run format`        | Format source and project files                 |
| `npm run format:check`  | Check formatting without changing files         |
| `npm run lint`          | Lint the TypeScript source and tests            |
| `npm run type-check`    | Type-check the TypeScript project               |
| `npm run build`         | Build the executable at `dist/planlet.mjs`      |
| `npm run skills:update` | Build CLI and refresh installed Planlet skills  |
| `npm test`              | Run TypeScript tests with `tsx` and `node:test` |

The design is documented in [`planlet_design.md`](planlet_design.md).

## License

[MIT](LICENSE)

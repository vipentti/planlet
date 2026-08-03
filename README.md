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

You normally drive Planlet through the skills and let your agent call the CLI.

## Installation

Planlet requires Node.js 22 or newer.

```sh
npm install -g @vipentti/planlet
```

That installs the `planlet` executable on your `PATH`. Or run it without
installing:

```sh
npx @vipentti/planlet <command>
```

From a source checkout:

```sh
git clone https://github.com/vipentti/planlet.git
cd planlet
npm ci
npm run build
node dist/planlet.mjs <command>
```

## Set up a repository

```sh
cd your-repository
planlet init
```

`init` creates `plans/` and installs the three agent skills. On an interactive
terminal it asks which harnesses to install for; otherwise it installs all of
them. Supported harnesses:

| Harness                     | `--tools` ID | Skill destination |
| --------------------------- | ------------ | ----------------- |
| Claude Code                 | `claude`     | `.claude/skills`  |
| Codex                       | `codex`      | `.agents/skills`  |
| Other `AGENTS.md` harnesses | `agents`     | `.agents/skills`  |

Commit the installed copies so everyone cloning the repository gets the same
workflows. Refresh them after a Planlet upgrade with `planlet update`, and
inspect installation state without mutating anything with `planlet tools`.

## The skill-first flow

Three skills cover the lifecycle. Invoke them by name in your agent (in Claude
Code, `/planlet-plan` and friends); each one resolves a single planlet and calls
the CLI for discovery, validation, progress, and archiving.

1. **Plan** — `planlet-plan` explores the repository and persists one focused
   planlet as `plans/<slug>/plan.md` and `tasks.md`. It does not implement
   product changes, so the plan stays reviewable before any code moves.
2. **Implement** — `planlet-implement` re-reads both files from disk, works
   through the tasks in dependency order, verifies each one, and checks it off
   only after its verification passes. It pauses instead of guessing when the
   plan is stale or a task is ambiguous. Check results live in your test, review,
   and CI systems, so a planlet records verification evidence only in the rare
   case that ordinary history cannot reconstruct it.
3. **Complete** — `planlet-complete` validates the planlet and archives it to
   `plans/completed/<YYYY-MM-DD>-<slug>/`. Unfinished tasks require an explicit
   override with a recorded reason.

A typical session: ask for a plan, review the two Markdown files yourself, then
ask for implementation, then completion. Nothing is hidden from review — the
plan, the task checkboxes, and the archive are all plain Markdown in git.

## Driving the CLI directly

Everything the skills do is available as commands:

```sh
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

## Skill installation details

Canonical workflows ship under `skills/planlet-*`; installed copies are
generated from them.

`--tools` accepts comma-separated `agents`, `claude`, and `codex` IDs.
`planlet init --tools none` creates only `plans/`. Locally modified generated
files require explicit `--force` before replacement.

Without `--tools`, `planlet init` asks which destinations to install to when
run on an interactive terminal, defaulting to those that already contain
something. Passing `--tools`, or running with stdin or stdout redirected, skips
the question and installs every destination, so agents and CI are unaffected.
`planlet update` never asks; it refreshes only destinations that already exist.

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

## Changelog and releases

Record user-visible changes under `Unreleased` in
[`CHANGELOG.md`](https://github.com/vipentti/planlet/blob/main/CHANGELOG.md).
At release time, move those entries into a dated version section and restore an
empty `Unreleased` section. Ordinary CI runs
`node scripts/assert-changelog-release-ready.mjs`, which requires exactly one
`[Unreleased]` section and at most one structurally valid dated section for the
current `package.json` version. Malformed headings that mention `Unreleased` or
that version still count toward those limits. Explicit release verification uses
`node scripts/assert-changelog-release-ready.mjs --release-date YYYY-MM-DD`.

From a source checkout, use `node scripts/changelog.mjs <version>` to extract
release notes; that helper is not included in the published npm package.

### Tag-triggered releases

After trusted publishing is configured, create an **annotated, signed** tag
`v<version>` that matches `package.json` and is reachable from `main`. Tag
creation for `v*` is limited by a repository ruleset; the release job runs in
the GitHub Environment `release` (required reviewer) and refuses force-moved or
deleted tag pushes. The workflow verifies GitHub reports a signed tag, checks
the tagged source, packs the verified build (`npm pack --ignore-scripts`),
publishes or verifies the exact `@vipentti/planlet` artifact with provenance,
re-checks registry identity/integrity after a new publish, then creates or
updates the GitHub release from the changelog. Do not push a release tag until
the version commit is on `main` and captain gates in the
[release automation plan](https://github.com/vipentti/planlet/blob/main/plans/release-automation/plan.md)
are satisfied. After changing the workflow environment name, keep the npm
trusted-publisher environment field in sync (`release`).

The first npm publication (`@vipentti/planlet@0.1.0`) was a manual bootstrap
without `release.yml` on `main`. Later releases use the tag workflow above.

## Links

- [Source repository](https://github.com/vipentti/planlet)
- [Product and technical design](https://github.com/vipentti/planlet/blob/main/planlet_design.md)
- [Contributor guide](https://github.com/vipentti/planlet/blob/main/AGENTS.md)
- [Issue tracker](https://github.com/vipentti/planlet/issues)
- [npm package](https://www.npmjs.com/package/@vipentti/planlet)

## License

[MIT](https://github.com/vipentti/planlet/blob/main/LICENSE)

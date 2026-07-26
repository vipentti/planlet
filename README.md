# Planlet

Small plans. Clear handoffs.

Planlet is a repository-local planning and task-management utility. The CLI is
currently being built from the design in [`planlet_design.md`](planlet_design.md).

## Development

Planlet requires Node.js 22 or newer.

| Command                 | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `npm run format`        | Format source and project files                 |
| `npm run format:check`  | Check formatting without changing files         |
| `npm run lint`          | Lint the TypeScript source and tests            |
| `npm run type-check`    | Type-check the TypeScript project               |
| `npm run build`         | Build the executable at `dist/planlet.mjs`      |
| `npm run skills:update` | Build CLI and refresh installed Planlet skills  |
| `npm test`              | Run TypeScript tests with `tsx` and `node:test` |

## Harness installation

Canonical workflows live under `skills/planlet-*`. Install project-local
copies with `planlet init`, refresh existing copies with `planlet update`, and
inspect installation state without mutation with `planlet tools`.

`--tools` accepts comma-separated `agents`, `claude`, and `codex` IDs.
`agents` and `codex` share `.agents/skills`; `claude` uses `.claude/skills`.
Omitting `--tools` selects all adapters. `planlet init --tools none` creates
only `plans/`. Locally modified generated files require explicit `--force`
before replacement.

# Planlet

Small plans. Clear handoffs.

Planlet is a repository-local planning and task-management utility. The CLI is
currently being built from the design in [`planlet_design.md`](planlet_design.md).

## Development

Planlet requires Node.js 22 or newer.

| Command                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `npm run format`       | Format source and project files                 |
| `npm run format:check` | Check formatting without changing files         |
| `npm run lint`         | Lint the TypeScript source and tests            |
| `npm run type-check`   | Type-check the TypeScript project               |
| `npm run build`        | Build the executable at `dist/planlet.mjs`      |
| `npm test`             | Run TypeScript tests with `tsx` and `node:test` |

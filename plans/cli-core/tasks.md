# Tasks: CLI Core

- [ ] T1 Create the TypeScript and Node.js package, build, and executable scaffold, including a `.gitignore` covering standard Node.js/TypeScript build and tooling artifacts, plus a test runner setup that executes TypeScript test files directly via `tsx` atop `node:test` (dev dependency, `test` npm script, `tests/` directory layout)
- [ ] T14 Set up ESLint (linting) and Prettier (formatting) as dev dependencies with documented `lint` and `format`/`format:check` npm scripts, and add `@toon-format/toon` as a runtime dependency
- [ ] T2 Define the domain models (including advisory `warnings`), structured errors, and exit-code categories
- [ ] T3 Implement repository-root discovery, safe path resolution, and slug and archive-name validation
- [ ] T4 Implement narrow task parsing, planlet structural validation, completion-record validation, and lifecycle status derivation
- [ ] T5 Implement safe planlet creation with automatic `plans/` setup, validated or derived titles, exactly two H1-only stub files, `draft` status, logical-slug collision refusal, and no partial result on failure
- [ ] T15 Implement the list, show, status, tasks, and validate read-only operations, including their `--state`, `--completed`, `--part`, `--all`, and `--remaining`/`--completed` flags
- [ ] T6 Implement atomic, idempotent task check and uncheck operations that preserve unrelated Markdown
- [ ] T7 Implement normal and incomplete-override completion with one UTC timestamp, audit recording, collision refusal, and safe movement
- [ ] T8 Implement the default output renderer using the official `@toon-format/toon` library, with stdout and stderr separation, warnings surfaced as diagnostics, and `--full`-aware truncation; keep the structured-result model renderer-agnostic so `--json`, `--human`, and `--quiet` can be added later
- [ ] T9 Wire command parsing, explicit root selection, no-argument dashboard behavior, help, and command dispatch, implementing commands as directly callable handlers with an injected execution context (root, stdout/stderr sinks, clock) so most behavior is testable in-process without spawning the compiled executable
- [ ] T10 Add TypeScript unit tests, executed via `tsx`'s `node:test` integration, for domain rules, status, rendering, errors, timestamps, and archive names
- [ ] T11 Add disposable integration fixtures, written as TypeScript and executed via `tsx`, for creation scaffolds and failure cleanup, command workflows, malformed data, collisions, unsafe paths, and symlink escape, invoking command handlers in-process
- [ ] T13 Add a smaller set of compiled-executable fixtures that spawn the built `planlet` binary to verify end-to-end argv parsing, stdout/stderr separation, and exit-code behavior
- [ ] T12 Run the full verification suite and document the stable repository commands in `AGENTS.md`

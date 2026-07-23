# CLI Core

## Summary

Implement Planlet's Phase 1 TypeScript and Node.js command-line core so agents and humans can deterministically create, inspect, validate, update, and complete repository-local planlets. Keep Markdown as the source of truth and keep domain behavior independent from argument parsing and output rendering.

## Motivation

The bootstrap skills currently reproduce a narrow set of filesystem checks because no Planlet CLI exists. A tested CLI core will move slug validation, repository discovery, task parsing, status calculation, safe writes, and lifecycle movement into one deterministic implementation. The skills can then delegate these operations instead of maintaining parallel mechanics.

## Scope

- Establish the TypeScript package, build, test, and executable scaffolding for Node.js 22 and newer, including a `.gitignore` covering standard Node.js/TypeScript build and tooling artifacts. Write all tests in TypeScript and execute them directly with `tsx` layered on Node's built-in `node:test` runner. Set up ESLint for linting and Prettier for formatting, each with a documented npm script.
- Structure command handlers as directly callable functions with an injected execution context (repository root, stdout/stderr sinks, clock), decoupled from process wiring (argv parsing, process stdout/stderr, exit codes), so the large majority of CLI behavior is exercisable in-process without spawning the compiled executable.
- Discover repository roots and resolve Planlet paths without escaping the selected root.
- Validate active and completed planlet names, required files, H1 headings, recognized tasks, unique task IDs, completion records, and archive dates.
- Derive planlet lifecycle states from file location and task progress.
- Implement create, list, show, status, validate, tasks, task check, task uncheck, and complete operations, plus the content-first no-argument dashboard. `create` creates `plans/` automatically when it does not already exist and safely scaffolds H1-only `plan.md` and `tasks.md` files for an agent or human to populate, so no separate initialization command is required in this planlet.
- Support normal completion and explicit incomplete override with a non-empty reason.
- Render the default agent-oriented output using the official TOON library (`@toon-format/toon`), following AXI compact-output recommendations, with structured errors and stable exit-code categories.
- Cover domain behavior and filesystem workflows with unit and disposable integration fixtures.
- Document the stable commands in `AGENTS.md` once they exist.

## Out of Scope

- Harness installation or generated copies under `.agents/`, `.claude/`, `.codex/`, or other tool directories.
- User-level skill installation, command adapters, registry publishing, npm release automation, or native executable distribution.
- Modifying, hardening, or revising the bootstrap `planlet-plan`, `planlet-implement`, and `planlet-complete` skills. `planlet_design.md` §21 assigns that work to Phase 2; this plan only needs to leave behind a CLI contract those skills can later delegate to.
- Pull-request creation, Git staging or commits, concurrency locks, optimistic hashes, planlet rename or reopen workflows, and custom plan-directory configuration beyond the designed `--root` behavior.
- General Markdown parsing, semantic assessment of implementation correctness, or LLM calls from the CLI.
- `--json`, `--human`, and `--quiet` output renderers. This phase ships only the default agent-oriented TOON output; the other formats are deferred to a later planlet.

## Approach

### Package and boundaries

Use TypeScript for source and compile to JavaScript for Node.js. Keep reusable domain modules for repository discovery, paths, slugs, planlets, task parsing, validation, status, completion, and errors separate from command handlers and output renderers. Prefer Node built-ins, `util.parseArgs()`, and `node:test`; add runtime dependencies only when they materially reduce risk. The official TOON library (`@toon-format/toon`, see Command and output model) is a deliberate exception: it is the officially recommended serializer for this exact compact-output use case, and adopting it now reduces the risk of an incorrect hand-rolled implementation of the format.

Add ESLint (linting) and Prettier (formatting) as development-only dependencies with documented `lint` and `format`/`format:check` npm scripts, so the scaffold produces the format, lint, type-check, build, and test commands exercised by Verification. Keep configuration minimal and let Prettier own stylistic formatting so ESLint rules do not conflict with it.

The package scaffold includes a `.gitignore` so dependency installs and build output are never tracked. At minimum it excludes `node_modules/`, the `dist/` build output (per §16.1's `dist/planlet.mjs` bundle), `*.tsbuildinfo`, test/coverage output, ESLint/Prettier cache files, package-manager debug logs, `.env*` files, and common OS and editor artifacts (for example `.DS_Store`, `.vscode/`, `.idea/`).

### Test tooling

Write every test in TypeScript and run it directly with `tsx` on top of Node's built-in `node:test` runner (for example `tsx --test tests/**/*.test.ts`), so tests execute without a separate compile step during development. Add `tsx` as a development-only dependency and a `test` npm script that invokes it; the compiled `dist/planlet.mjs` bundle remains the only artifact packaged for distribution. This is a test-only use of on-the-fly TypeScript execution: it does not conflict with `planlet_design.md` §16.1's guidance against relying on raw TypeScript execution for the distributed CLI, because installed users only ever run the compiled bundle and never execute source or test files directly.

### Filesystem model

Resolve all operations from an explicit or discovered repository root. Reject unsafe slugs and paths before mutation, detect symlink escape where relevant, and never overwrite an active or completed planlet. Treat `plans/<slug>/plan.md` and `tasks.md` as the complete active record and parse only the narrow top-level task syntax defined by `planlet_design.md`.

Use atomic replacement for task-file updates. Make task checking idempotent and preserve unrelated Markdown. Completion must capture one UTC timestamp, derive the archive date from it, append the audit record, recheck logical-slug and destination collisions, and move the whole planlet without Git index manipulation.

`create` ensures `plans/` exists by creating it automatically when missing, so no separate initialization step is required in this planlet; a dedicated `init` command and harness skill installation (`--tools claude|codex|...`) are deferred to a later phase and are not implemented here. Scaffold both primary files exactly as specified by `planlet_design.md` §10.5: minimal H1-only stubs, `--title` validation with a slug-derived fallback title, one atomic creation operation so failures cannot expose a partial planlet, and refusal of active or completed logical-slug conflicts. The result is structurally valid with zero recognized tasks and therefore has the `draft` state, ready for an agent or human to populate and validate.

### Command and output model

Build thin command handlers over the domain modules. Each handler accepts parsed arguments and an injected execution context (repository root, stdout/stderr sinks, clock) and returns a structured result, rather than reading `process.argv`/`process.env`, writing to `process.stdout`/`process.stderr`, or calling `process.exit` directly. This lets unit and integration tests invoke command logic directly in-process for the majority of coverage. A thin outer layer (argument parsing, root discovery, process I/O, exit-code mapping) wraps these handlers for real invocation and is covered by a smaller set of fixtures that spawn the compiled executable end-to-end. Mutating commands require one explicit slug; read-only listing and resolution expose explicit empty and ambiguous states. Running `planlet` without arguments displays the active-plan dashboard, while help remains explicitly available.

Represent successful results and failures as structured internal models, including a `warnings` list on planlet summaries for advisory hygiene issues (for example a completed planlet with unchecked tasks and no override record) that must not be conflated with hard validation errors. Render the default output by serializing these structured models through the official TOON library (`@toon-format/toon`), keeping list records minimal (slug, state, completed count, total count) and empty results explicit, per AXI compact-output principles. Truncate large plan or task content with a size hint and honor `--full` to disable truncation. Send data to stdout and diagnostics (including warnings) to stderr, and map error categories to documented exit codes. Keep the structured-result model itself renderer-agnostic so `--json`, `--human`, and `--quiet` can be added in a later planlet without changing domain or command logic.

Lock the command contract implemented by this plan to `planlet_design.md` §13.2's flag set: `list [--state <state>] [--completed]`, `show <slug> [--part plan|tasks|summary]`, `validate [<slug>|--all]`, and `tasks <slug> [--remaining|--completed]`, alongside the unflagged `create <slug> [--title <title>]`, `status <slug>`, `task check|uncheck <slug> <task-id>`, and `complete <slug> [--allow-incomplete --reason <text>]`. Lock error handling to the exact codes and exit-code categories in `planlet_design.md` §13.5: `repo_not_found`, `plans_not_initialized`, `invalid_slug`, `plan_not_found`, `plan_already_exists`, `completed_plan_exists`, `invalid_plan`, `task_not_found`, `duplicate_task_id`, `incomplete_tasks`, `archive_collision`, `unsafe_path`, and `write_conflict`, mapped to exit codes `0`–`5` as documented there. `init`, `update`, `tools`, the `archive` alias, and the `unsupported_tool` error code stay deferred to the phases that implement harness installation.

### Verification strategy

Use unit tests for validation, parsing, state derivation, archive-name handling, TOON rendering, and error mapping. Use disposable repositories for discovery, initialization, multiple active plans, task updates, completion records and movement, incomplete overrides, collisions, malformed data, path traversal, symlink escape, and stdout/stderr behavior. Write and run all of these tests as TypeScript files executed directly via `tsx`'s `node:test` integration; prefer invoking command handlers in-process (see Command and output model) over spawning the compiled executable, reserving compiled-executable fixtures for end-to-end argv, exit-code, and stdout/stderr framing checks. Test supported Node versions in CI when CI is introduced.

## Acceptance Criteria

- The repository has documented format, lint, type-check, build, and test commands that produce a runnable `planlet` executable from TypeScript source.
- The repository includes a `.gitignore` that excludes `node_modules/`, build output, and other common Node.js/TypeScript artifacts so they are never accidentally tracked.
- Commands discover or accept a repository root and never resolve Planlet mutations outside it.
- `create` creates `plans/` automatically when it is missing and safely creates exactly the two H1-only primary files, using a validated explicit title or a title deterministically derived from the slug, so no prior initialization step is required.
- A newly created scaffold refuses active or completed logical-slug conflicts, is reported as a structurally valid `draft`, contains no placeholder tasks or semantic prose, and cannot be left partially visible after a failed creation.
- Slugs, active planlets, completed archive names, tasks, task IDs, completion records, and lifecycle states follow `planlet_design.md`.
- Create and read-only commands produce deterministic results for empty, valid, invalid, active, and completed states.
- Task check and uncheck operations are idempotent, preserve unrelated Markdown, and use safe writes.
- Normal completion refuses unchecked tasks; an incomplete override requires an explicit reason and records the remaining task IDs.
- Completion uses one UTC instant for both its audit record and date-prefixed archive path and refuses logical-slug conflicts and destination collisions without losing the source.
- `list`, `show`, `validate`, and `tasks` implement exactly the `--state`, `--completed`, `--part`, `--all`, and `--remaining`/`--completed` flags locked in Approach, with no additional undocumented flags.
- The default TOON output keeps data and diagnostics separated and implements the exact error codes and exit-code categories locked in Approach; `--json`, `--human`, and `--quiet` are explicitly deferred to a later phase.
- Advisory hygiene issues (unchecked tasks under a recorded override, missing recommended sections, oversized content) surface as `warnings`, distinct from structural validation errors, and large content truncates with a `--full` escape hatch.
- Unit and disposable integration tests cover successful workflows and the principal safety failures.
- Tests are written in TypeScript and run directly via `tsx` atop `node:test`, with a documented `test` script; no separate compile step is required to run them.
- Command handlers are directly callable, dependency-injected functions decoupled from process wiring, so the large majority of CLI behavior is covered in-process, with a smaller set of fixtures exercising the compiled executable end-to-end.
- The implemented CLI contract is shaped so the bootstrap skills could delegate their deterministic Phase 1 operations to it without changing the two-file Planlet contract; this plan does not itself modify the bootstrap skills, which `planlet_design.md` §21 assigns to Phase 2.

## Verification

- Run the documented format, type-check, build, lint, and test commands introduced by the package scaffold, including the `tsx`-executed TypeScript test suite.
- Run unit tests for slugs, archive names and dates, task parsing, duplicate IDs, state derivation, rendering, and error mapping, invoking command handlers directly in-process where applicable.
- Run integration fixtures for repository discovery, creation (including automatic `plans/` creation on a fresh repository, minimal stub contents, title handling, `draft` status, creation-time slug-collision refusal, and simulated partial failure), listing, validation, task updates, normal completion, incomplete overrides, completion-time logical-slug and archive-destination collisions, malformed structures, unsafe paths, and symlink escape.
- Exercise the compiled CLI's default TOON output and `--full` truncation behavior, checking stdout, stderr, and exit codes independently. `--json`, `--human`, and `--quiet` are out of scope for this phase and are not exercised.
- Run `git diff --check` and confirm generated build artifacts do not introduce unintended tracked files.
- After running a build and test cycle, confirm `git status` shows no untracked build or dependency artifacts, verifying `.gitignore` coverage.

## Risks and Considerations

- The public CLI contract will become a dependency of agent skills, so command shapes, structured errors, and the TOON output shape need focused tests before stabilization.
- Atomic file replacement and directory movement behave differently across platforms; integration fixtures should cover maintained operating systems when CI is available.
- Completed archive parsing must distinguish a real UTC date prefix from the unchanged logical slug and enforce logical-slug uniqueness across dates.
- Compact output should remain token-efficient without becoming an undocumented format that integrations cannot consume safely.
- `@toon-format/toon` is an external runtime dependency; pin its version and confirm its serialized output stays deterministic across the versions the project accepts, since default-output determinism is part of the CLI contract.
- Shipping only TOON output in this phase means the bootstrap skills and any early consumers must be able to work with TOON as the sole machine-readable format until `--json` lands; confirm this is acceptable before skills start depending on the CLI contract.

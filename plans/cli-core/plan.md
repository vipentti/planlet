# CLI Core

## Summary

Implement Planlet's Phase 1 TypeScript and Node.js command-line core so agents and humans can deterministically create, inspect, validate, update, and complete repository-local planlets. Keep Markdown as the source of truth and keep domain behavior independent from argument parsing and output rendering.

## Motivation

The bootstrap skills currently reproduce a narrow set of filesystem checks because no Planlet CLI exists. A tested CLI core will move slug validation, repository discovery, task parsing, status calculation, safe writes, and lifecycle movement into one deterministic implementation. The skills can then delegate these operations instead of maintaining parallel mechanics.

## Scope

- Establish the TypeScript package, build, test, and executable scaffolding for Node.js 22 and newer, including a `.gitignore` covering standard Node.js/TypeScript build and tooling artifacts.
- Discover repository roots and resolve Planlet paths without escaping the selected root.
- Validate active and completed planlet names, required files, H1 headings, recognized tasks, unique task IDs, completion records, and archive dates.
- Derive planlet lifecycle states from file location and task progress.
- Implement create, list, show, status, validate, tasks, task check, task uncheck, and complete operations, plus the content-first no-argument dashboard. `create` creates `plans/` automatically when it does not already exist and safely scaffolds H1-only `plan.md` and `tasks.md` files for an agent or human to populate, so no separate initialization command is required in this planlet.
- Support normal completion and explicit incomplete override with a non-empty reason.
- Render compact deterministic default output, versioned JSON, and human-readable output with structured errors and stable exit-code categories.
- Cover domain behavior and filesystem workflows with unit and disposable integration fixtures.
- Document the stable commands in `AGENTS.md` once they exist.

## Out of Scope

- Harness installation or generated copies under `.agents/`, `.claude/`, `.codex/`, or other tool directories.
- User-level skill installation, command adapters, registry publishing, npm release automation, or native executable distribution.
- Phase 2 skill hardening beyond adjustments required to use the implemented CLI contract.
- Pull-request creation, Git staging or commits, concurrency locks, optimistic hashes, planlet rename or reopen workflows, and custom plan-directory configuration beyond the designed `--root` behavior.
- General Markdown parsing, semantic assessment of implementation correctness, or LLM calls from the CLI.

## Approach

### Package and boundaries

Use TypeScript for source and compile to JavaScript for Node.js. Keep reusable domain modules for repository discovery, paths, slugs, planlets, task parsing, validation, status, completion, and errors separate from command handlers and output renderers. Prefer Node built-ins, `util.parseArgs()`, and `node:test`; add runtime dependencies only when they materially reduce risk.

The package scaffold includes a `.gitignore` so dependency installs and build output are never tracked. At minimum it excludes `node_modules/`, the `dist/` build output (per §16.1's `dist/planlet.mjs` bundle), `*.tsbuildinfo`, test/coverage output, package-manager debug logs, `.env*` files, and common OS and editor artifacts (for example `.DS_Store`, `.vscode/`, `.idea/`).

### Filesystem model

Resolve all operations from an explicit or discovered repository root. Reject unsafe slugs and paths before mutation, detect symlink escape where relevant, and never overwrite an active or completed planlet. Treat `plans/<slug>/plan.md` and `tasks.md` as the complete active record and parse only the narrow top-level task syntax defined by `planlet_design.md`.

Use atomic replacement for task-file updates. Make task checking idempotent and preserve unrelated Markdown. Completion must capture one UTC timestamp, derive the archive date from it, append the audit record, recheck logical-slug and destination collisions, and move the whole planlet without Git index manipulation.

`create` ensures `plans/` exists by creating it automatically when missing, so no separate initialization step is required in this planlet; a dedicated `init` command and harness skill installation (`--tools claude|codex|...`) are deferred to a later phase and are not implemented here. Scaffold both primary files exactly as specified by `planlet_design.md` §10.5: minimal H1-only stubs, `--title` validation with a slug-derived fallback title, one atomic creation operation so failures cannot expose a partial planlet, and refusal of active or completed logical-slug conflicts. The result is structurally valid with zero recognized tasks and therefore has the `draft` state, ready for an agent or human to populate and validate.

### Command and output model

Build thin command handlers over the domain modules. Mutating commands require one explicit slug; read-only listing and resolution expose explicit empty and ambiguous states. Running `planlet` without arguments displays the active-plan dashboard, while help remains explicitly available.

Represent successful results and failures as structured internal models, including a `warnings` list on planlet summaries for advisory hygiene issues (for example a completed planlet with unchecked tasks and no override record) that must not be conflated with hard validation errors. Render compact deterministic output by default, stable JSON containing `schemaVersion`, and an opt-in human format. Truncate large plan or task content with a size hint and honor `--full` to disable truncation. Send data to stdout and diagnostics (including warnings) to stderr, and map error categories to documented exit codes.

### Verification strategy

Use unit tests for validation, parsing, state derivation, archive-name handling, output, and error mapping. Use disposable repositories for discovery, initialization, multiple active plans, task updates, completion records and movement, incomplete overrides, collisions, malformed data, path traversal, symlink escape, and stdout/stderr behavior. Test supported Node versions in CI when CI is introduced.

## Acceptance Criteria

- The repository has documented build and test commands that produce a runnable `planlet` executable from TypeScript source.
- The repository includes a `.gitignore` that excludes `node_modules/`, build output, and other common Node.js/TypeScript artifacts so they are never accidentally tracked.
- Commands discover or accept a repository root and never resolve Planlet mutations outside it.
- `create` creates `plans/` automatically when it is missing and safely creates exactly the two H1-only primary files, using a validated explicit title or a title deterministically derived from the slug, so no prior initialization step is required.
- A newly created scaffold refuses active or completed logical-slug conflicts, is reported as a structurally valid `draft`, contains no placeholder tasks or semantic prose, and cannot be left partially visible after a failed creation.
- Slugs, active planlets, completed archive names, tasks, task IDs, completion records, and lifecycle states follow `planlet_design.md`.
- Create and read-only commands produce deterministic results for empty, valid, invalid, active, and completed states.
- Task check and uncheck operations are idempotent, preserve unrelated Markdown, and use safe writes.
- Normal completion refuses unchecked tasks; an incomplete override requires an explicit reason and records the remaining task IDs.
- Completion uses one UTC instant for both its audit record and date-prefixed archive path and refuses logical-slug conflicts and destination collisions without losing the source.
- Default, JSON, and human output keep data and diagnostics separated and use documented error and exit-code behavior.
- Advisory hygiene issues (unchecked tasks under a recorded override, missing recommended sections, oversized content) surface as `warnings`, distinct from structural validation errors, and large content truncates with a `--full` escape hatch.
- Unit and disposable integration tests cover successful workflows and the principal safety failures.
- The bootstrap skills can delegate their deterministic Phase 1 operations to the CLI without changing the two-file Planlet contract.

## Verification

- Run the documented format, type-check, build, lint, and test commands introduced by the package scaffold.
- Run unit tests for slugs, archive names and dates, task parsing, duplicate IDs, state derivation, rendering, and error mapping.
- Run integration fixtures for repository discovery, creation (including automatic `plans/` creation on a fresh repository, minimal stub contents, title handling, `draft` status, creation-time slug-collision refusal, and simulated partial failure), listing, validation, task updates, normal completion, incomplete overrides, completion-time logical-slug and archive-destination collisions, malformed structures, unsafe paths, and symlink escape.
- Exercise the compiled CLI's default, JSON, human, quiet, and full output where implemented, checking stdout, stderr, and exit codes independently.
- Run `git diff --check` and confirm generated build artifacts do not introduce unintended tracked files.
- After running a build and test cycle, confirm `git status` shows no untracked build or dependency artifacts, verifying `.gitignore` coverage.

## Risks and Considerations

- The public CLI contract will become a dependency of agent skills, so command shapes, structured errors, and JSON schemas need focused tests before stabilization.
- Atomic file replacement and directory movement behave differently across platforms; integration fixtures should cover maintained operating systems when CI is available.
- Completed archive parsing must distinguish a real UTC date prefix from the unchanged logical slug and enforce logical-slug uniqueness across dates.
- Compact output should remain token-efficient without becoming an undocumented format that integrations cannot consume safely.

# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository-local planlets with deterministic create, inspect, validate, task, and completion commands.
- Portable planning, implementation, and completion skills for Agent Skills-compatible tools and Claude Code.
- Project-local skill installation and update support for `agents`, `claude`, and `codex` destinations.
- Bundled `planlet` executable for Node.js 22 and newer.
- Per-planlet write locks for concurrent `task check` / `task uncheck` / `complete`.
- Structured `internal_error` production boundary with optional `PLANLET_DEBUG` diagnostics.
- Changelog release-date gate (`scripts/assert-changelog-release-ready.mjs`) for unpublished 0.1.0.

### Fixed

- Harness recovery guidance uses top-level `next` so CLI stderr shows it.
- Harness post-commit cleanup warnings emit as stderr diagnostics.
- Changelog gate counts malformed `Unreleased` / version headings before validating syntax.
- Successful lock operations warn when lock release fails instead of silent success.
- Locks publish ownership metadata atomically, so an interrupted acquisition cannot leave an unreclaimable lock.
- Changelog gate rejects release dates earlier than today (UTC) under `--release-date`; ordinary CI accepts a shipped version's past date instead of turning red the day after a release.
- A failed lock release keeps the operation's structured error code and reports the lock path in `next`, instead of surfacing as an unexpected internal error.
- Lock namespaces key on the canonical repository root, so two symlinked paths to one checkout no longer take separate locks.
- `planlet-lock.ts` uses a `\0` escape rather than a literal NUL byte, so git treats the file as text and can diff it.
- Harness lock release warnings are reported repository-wide instead of being attached to the first destination.

### Changed

- Write locks moved from `plans/.planlet-locks/` to a per-owner, per-repository directory in the OS temp directory, so lock files never appear in `git status` or an editor tree.
- Interactive `planlet init` prompts for skill destinations while non-interactive use remains deterministic.
- Documentation now leads with the skill-first workflow and complete CLI reference.
- Harness install/update publishes a destination transactionally and rolls back on failure.
- Selected harness tool installs no longer resolve unselected adapter paths.
- Completed planlets with normal completion and unchecked tasks are `invalid_plan`.
- Failed completion moves leave the audit record in place for resume instead of rewriting `tasks.md`.

### Security

- Repository and planlet paths reject traversal and symlink escape.
- Planlet creation, task updates, skill updates, and completion use recoverable or atomic filesystem operations.
- CI pins GitHub Actions to reviewed commit SHAs; Dependabot watches Actions updates.

[Unreleased]: https://github.com/vipentti/planlet/compare/v0.1.0...HEAD

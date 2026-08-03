# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository-local planlets with deterministic create, inspect, validate, task, and completion commands.
- Portable planning, implementation, and completion skills for Agent Skills-compatible tools and Claude Code.
- Project-local skill installation and update support for `agents`, `claude`, and `codex` destinations.
- Bundled `planlet` executable for Node.js 22 and newer.
- Write locks for concurrent `task check` / `task uncheck` / `complete` and harness installs, kept in a per-owner, per-repository directory in the OS temp directory so they never appear in `git status`. Locks carry an ownership token, reclaim dead holders, and report a failed release as a warning or in the operation's own structured error.
- Structured `internal_error` production boundary with optional `PLANLET_DEBUG` diagnostics.
- Changelog release-date gate (`scripts/assert-changelog-release-ready.mjs`) for unpublished 0.1.0.

### Changed

- Interactive `planlet init` prompts for skill destinations while non-interactive use remains deterministic.
- Documentation now leads with the skill-first workflow and complete CLI reference.
- Harness install/update publishes a destination transactionally, rolls back on failure, and reports incomplete cleanup and leftover recovery directories as stderr diagnostics with recovery guidance.
- Selected harness tool installs no longer resolve unselected adapter paths.
- Completed planlets with normal completion and unchecked tasks are `invalid_plan`.
- Failed completion moves leave the audit record in place for resume instead of rewriting `tasks.md`.

### Security

- Repository and planlet paths reject traversal and symlink escape.
- Planlet creation, task updates, skill updates, and completion use recoverable or atomic filesystem operations.
- CI pins GitHub Actions to reviewed commit SHAs; Dependabot watches Actions updates.

[Unreleased]: https://github.com/vipentti/planlet/compare/v0.1.0...HEAD

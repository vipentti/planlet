# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `show --part plan|tasks` compacts oversized content with a preview and size
  metadata; `--full` returns the complete content, and non-show output is no
  longer truncated.

## [0.1.2] - 2026-08-04

### Changed

- Move changelog and tag-release guidance from `README.md` into `RELEASING.md`.

### Fixed

- Stop the `planlet-plan` skill from naming `planlet_design.md` directly; agents read applicable repository instructions instead.

## [0.1.1] - 2026-08-03

### Added

- Tag-triggered GitHub Actions release workflow that publishes `@vipentti/planlet` with npm provenance and creates matching GitHub releases from the changelog.

### Changed

- README installation leads with the published `@vipentti/planlet` package and documents the signed-tag release flow (Environment `release`, `v*` tag rules).

## [0.1.0] - 2026-08-03

First release. Everything below is new, so these notes describe what Planlet is rather than how it changed.

### Added

- Repository-local planlets: a plan and its tasks as two Markdown files under `plans/<slug>/`, with `plans/completed/<YYYY-MM-DD>-<slug>/` for finished work.
- `planlet` CLI for creating, inspecting, validating, and completing planlets, checking and unchecking tasks, and reporting progress. Deterministic output and structured error codes throughout.
- Planning, implementation, and completion skills for Claude Code and other Agent Skills-compatible tools, installable per project with `planlet init` and refreshed with `planlet update`. `planlet init` prompts for destinations when run interactively and stays deterministic when it is not.
- Bundled executable requiring only Node.js 22 or newer.
- Concurrent `task check`, `task uncheck`, `complete`, and skill installs are serialized by write locks held outside the repository, so a lock never appears in `git status`. A competing run fails with `write_conflict` and guidance rather than applying a stale read-modify-write. Stale locks require confirmed manual removal; release renames aside and deletes only when the ownership token still matches.
- Interrupted work is recoverable: skill installation rolls back to its exact prior state, an interrupted completion keeps its audit record so the move can be resumed, and unrelated skills in a shared destination are never touched.
- Unexpected failures surface as a structured `internal_error` with no stack or path leakage; set `PLANLET_DEBUG=1` for diagnostic detail.
- Planlet and repository paths reject directory traversal and symlink escape, and file writes are atomic or recoverable.

[Unreleased]: https://github.com/vipentti/planlet/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/vipentti/planlet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vipentti/planlet/releases/tag/v0.1.0

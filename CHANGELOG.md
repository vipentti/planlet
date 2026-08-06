# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `planlet onboard` prints a short agent-onboarding snippet for pasting into
  agent instruction files.
- `planlet init` writes the onboarding section to `AGENTS.md` by default and
  to `CLAUDE.md` when that file exists and does not already import
  `AGENTS.md`, fenced by planlet-owned markers; `--no-agents` skips both
  files.
- `planlet update` refreshes present planlet onboarding markers without
  creating sections in repositories that opted out.

### Fixed

- `release:prepare` now refreshes compare links for new releases and keeps prior links.

## [0.2.0] - 2026-08-05

### Added

- `planlet init` and `planlet update` now accept an explicit `github-copilot`
  tool ID for GitHub Copilot, sharing the existing `.agents/skills` destination
  with `agents` and `codex`.
- `task check` and `task uncheck` now report post-write plan `state`, `done`,
  `total`, and a `next` handoff hint when the plan becomes `ready_to_complete`.
- Planlet skills declare standard Agent Skills frontmatter
  `allowed-tools: Bash(planlet:*)`, `compatibility: Requires planlet CLI.`, and
  `license: MIT`; Claude Code pre-approves literal `planlet` commands for the
  invoking turn.

### Changed

- Installation manifests are now schema v2 and no longer record a `tools`
  array — the tool set is implicit in the destination directory. Manifests
  written by earlier releases (schema v1) are accepted and automatically
  upgraded to v2 on the next `planlet update`.
- Skills now require an available `planlet` executable and no longer describe a CLI-unavailable fallback; with no working install path, agents stop and report naming the missing executable instead of hand-managing planlet files.
- `show --part plan|tasks` compacts oversized content with a preview and size
  metadata; `--full` returns the complete content, and non-show output is no
  longer truncated.
- Skill manifest entries are now ordered with locale-independent codepoint
  comparison; running `planlet update` may reorder entries in an existing
  `.planlet-manifest.json` once.

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

[Unreleased]: https://github.com/vipentti/planlet/compare/v0.1.2...HEAD
[0.2.0]: https://github.com/vipentti/planlet/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/vipentti/planlet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vipentti/planlet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vipentti/planlet/releases/tag/v0.1.0

# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Active `planlet validate` now rejects indented continuation lines immediately following a task in `tasks.md` (matching `/^(?: {2}|\t)[ \t]*\S/`), preserving one physical line per task (`- [ ] T1 <description>`). Rejected followers fail with `invalid_plan` and details `{ taskId, line, content }` (exit 3); task-like followers keep their existing parser diagnostic without `taskId`. Completed archives are exempt. Extended detail belongs in `plan.md`.

## [0.5.0] - 2026-08-11

### Changed

- The planlet-plan skill now teaches a concise planning contract: `plan.md`
  states each material requirement once and `tasks.md` is a compact execution
  index that does not duplicate detailed plan requirements, with a companion
  statement in the planlet-implement skill making the layering explicit.

## [0.4.3] - 2026-08-09

### Fixed

- Generated agent onboarding now follows the same CLI availability policy as
  the bundled Planlet skills, trying install or `npx` before stopping and
  never hand-managing CLI-owned lifecycle state.

## [0.4.2] - 2026-08-09

### Changed

- The agent-onboarding snippet written by `planlet init` and printed by
  `planlet onboard` now distinguishes CLI-owned lifecycle operations
  (checkbox flips, completion record, archive) from plan and task content,
  which the agent edits directly.

## [0.4.1] - 2026-08-08

### Fixed

- planlet-implement and planlet-complete skills now state the commit-boundary invariant: planlet state must never trail the repository state it describes across a commit, push, or branch boundary. Commit authority and commit granularity stay with the user; staged planlet changes may be left pending for the caller to commit.

## [0.4.0] - 2026-08-08

### Added

- `planlet task check` / `task uncheck` and `complete` now stage the planlet
  files they write or move with explicit pathspecs when the repository uses
  git, scoped to exactly those paths. A completion move stages its deletion
  and destination in one path-scoped `git add -A` when the planlet was
  already tracked or staged, so the index can never be left half-applied; a
  never-tracked planlet stages only its destination. A git failure is a
  warning, never a failed command.

## [0.3.2] - 2026-08-07

### Added

- `planlet onboard` prints a short agent-onboarding snippet for pasting into
  agent instruction files.
- `planlet init` writes the onboarding section to `AGENTS.md` by default and
  to `CLAUDE.md` when that file exists and does not already import
  `AGENTS.md`, fenced by planlet-owned markers; `--no-agents` skips both
  files.
- `planlet update` refreshes present planlet onboarding markers without
  creating sections in repositories that opted out.

### Changed

- Interactive `planlet init` now preselects harness destinations from
  repository-local agents, Claude Code, Codex, and GitHub Copilot markers while
  ignoring Planlet's own installed skill footprint.

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

[Unreleased]: https://github.com/vipentti/planlet/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/vipentti/planlet/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/vipentti/planlet/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/vipentti/planlet/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/vipentti/planlet/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/vipentti/planlet/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/vipentti/planlet/compare/v0.2.0...v0.3.2
[0.2.0]: https://github.com/vipentti/planlet/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/vipentti/planlet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vipentti/planlet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vipentti/planlet/releases/tag/v0.1.0
[Unreleased]: https://github.com/vipentti/planlet/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/vipentti/planlet/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/vipentti/planlet/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/vipentti/planlet/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/vipentti/planlet/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/vipentti/planlet/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/vipentti/planlet/compare/v0.2.0...v0.3.2
[0.2.0]: https://github.com/vipentti/planlet/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/vipentti/planlet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vipentti/planlet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vipentti/planlet/releases/tag/v0.1.0

# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-31

### Added

- Repository-local planlets with deterministic create, inspect, validate, task, and completion commands.
- Portable planning, implementation, and completion skills for Agent Skills-compatible tools and Claude Code.
- Project-local skill installation and update support for `agents`, `claude`, and `codex` destinations.
- Bundled `planlet` executable for Node.js 22 and newer.

### Changed

- Interactive `planlet init` prompts for skill destinations while non-interactive use remains deterministic.
- Documentation now leads with the skill-first workflow and complete CLI reference.

### Security

- Repository and planlet paths reject traversal and symlink escape.
- Planlet creation, task updates, skill updates, and completion use recoverable or atomic filesystem operations.

[Unreleased]: https://github.com/vipentti/planlet/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vipentti/planlet/releases/tag/v0.1.0

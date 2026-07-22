# Synchronize Harness Skills

## Summary

Add a temporary, directly executable PowerShell script that synchronizes the canonical Planlet skills from `skills/` into the generic `.agents/skills/` and Claude Code `.claude/skills/` project-local discovery paths.

## Motivation

The canonical skills currently need to be copied manually into harness-specific directories, and only `.agents/skills/` has been scaffolded. Until the Planlet CLI implements deterministic harness installation and update commands, a small repository-local script will make it easy to refresh both generic Agent Skills and Claude Code copies without maintaining separate workflow sources.

PowerShell (via `pwsh`) is used instead of the Node.js/TypeScript stack recommended for Planlet's permanent architecture because no Node/npm scaffold exists in this repository yet (Phase 1 of `planlet_design.md` is not implemented) and PowerShell Core runs unmodified on Windows, macOS, and Linux, matching Planlet's multi-harness, cross-platform intent better than a POSIX shell script would. This is a deliberate, scoped deviation from the default architecture guidance in `AGENTS.md`, justified only because the script is temporary scaffolding removed once the CLI takes over harness installation.

## Scope

- Add `sync-skills.ps1` at the repository root.
- Start the script with `#!/usr/bin/env pwsh` so it can be invoked as `./sync-skills.ps1` without an explicit `pwsh` command.
- Resolve all source and destination paths relative to the script’s repository location rather than the caller’s current directory.
- Treat `skills/` as the authoritative source.
- Synchronize complete ordinary-file copies into:
  - `.agents/skills/`
  - `.claude/skills/`
- Create missing destination directories and remove stale destination content so each generated skill tree matches its canonical source.
- Scope stale-content removal to top-level destination entries whose name matches a canonical skill directory under `skills/` (currently the `planlet-*` entries), leaving any other content placed directly under `.agents/skills/` or `.claude/skills/` untouched.
- Emit a concise summary of the synchronized destinations.
- Mark the script executable in Git.

## Out of Scope

- Implementing `planlet init`, `planlet update`, or the permanent harness adapter architecture.
- Synchronizing `.codex/skills/` or other harness destinations.
- Creating symlinks or harness-specific command adapters.
- Watching for changes or synchronizing continuously.
- Supporting user-level skill installation.
- Modifying the canonical skill content.
- Preserving manual edits inside the generated destination skill trees.

## Approach

Implement the synchronization using portable PowerShell filesystem operations. The script will derive the repository root from `$PSScriptRoot`, validate that the canonical `skills/` directory exists, and then update each configured project-local destination from that source.

Destination skill trees are generated artifacts, but only for the top-level entries Planlet itself generates. The script will reconcile stale files and directories within each `planlet-*` destination entry (and remove whole `planlet-*` entries that no longer exist in `skills/`) before copying the canonical tree, so removed or renamed canonical resources do not survive in either harness copy, while any unrelated top-level content a user or another tool placed directly under `.agents/skills/` or `.claude/skills/` is left alone. It will fail clearly on missing source content or filesystem errors and return a non-zero exit status rather than reporting partial synchronization as successful.

Keep the destination list explicit and the implementation deliberately small. This script is temporary scaffolding and should be removed when the CLI provides equivalent protected, deterministic update behavior.

## Acceptance Criteria

- `./sync-skills.ps1` runs through its shebang without requiring `pwsh ./sync-skills.ps1`.
- Running the script from any working directory resolves the repository and canonical source correctly.
- Missing `.agents/skills/` and `.claude/skills/` directories are created automatically.
- After a successful run, both destination skill trees contain ordinary-file copies matching `skills/`.
- Canonical additions, updates, and removals are reflected in both destinations on the next run.
- Repeated execution without canonical changes is idempotent.
- Non-canonical content placed directly under either destination directory outside a `planlet-*` entry survives a sync run untouched.
- The script's `.ps1` file has the executable Git file mode (`100755`) after being added.
- Failures produce a non-zero exit status and do not print a false success message.
- The script contains no permanent CLI or harness-installer implementation.

## Verification

Run the script directly from the repository root and from another working directory. Compare the relative directory structure and file hashes under `skills/`, `.agents/skills/`, and `.claude/skills/`. Exercise idempotency with a second run and use a disposable destination fixture to verify creation, update, and stale-file removal behavior without altering canonical skills, including a fixture entry outside any `planlet-*` directory that must survive the run untouched. Confirm the executable Git mode and shebang, parse the script with PowerShell, and run `git diff --check`.

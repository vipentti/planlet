# Planlet Agent Guide

## Token efficiency

Respond like smart caveman. Cut all filler, keep technical substance.

- Drop articles (a, an, the), filler (just, really, basically, actually).
- Drop pleasantries (sure, certainly, happy to).
- No hedging. Fragments fine. Short synonyms.
- Technical terms stay exact. Code blocks unchanged.
- Pattern: [thing] [action] [reason]. [next step].

## Subagents

Delegate to a subagent only for large tasks that are genuinely independent and parallelizable, such as a wide multi-file investigation. Do not delegate work you can finish yourself in a handful of tool calls, and do not use subagents to verify or double-check your own work. If one subagent can complete the task, use one rather than several, and keep spawn counts low.

## Project overview

Planlet is a lightweight, repository-local planning and task-management utility for AI coding agents and human reviewers. A planlet is a focused implementation plan stored as exactly two primary Markdown files:

```text
plans/<slug>/
├── plan.md
└── tasks.md
```

Completed planlets move to `plans/completed/<YYYY-MM-DD>-<slug>/`, using the UTC date of completion while retaining the original logical slug. Markdown files are the source of truth. Agent skills provide investigation and judgment; the CLI provides deterministic discovery, validation, progress, and lifecycle operations.

Tagline: **Small plans. Clear handoffs.**

## Authoritative context

Read [`planlet_design.md`](planlet_design.md) before making product, architecture, file-contract, CLI-interface, lifecycle, or skill-workflow decisions. It is the authoritative product and technical design.

For scoped implementation work, also read the selected planlet's `plan.md` and `tasks.md` completely. A planlet may refine implementation details for its own scope, but it must not silently contradict the main design. Surface material conflicts before proceeding.

This file does not track which planlet is currently active. Inspect `plans/` to see what exists, and ask the user which one to target when more than one is active or none is obvious from the request.

Keep this file short and navigational. Durable product detail belongs in the design document, and change-specific, in-progress detail belongs in a planlet under `plans/`.

## Current repository state

Do not assume a fixed development phase or a specific set of files that should exist. Inspect the repository directly (for example, whether a `planlet` CLI, package scaffold, build, or test suite exists) before acting, and read `plans/` to see what work is currently planned, in progress, or completed.

When a described CLI capability is not yet present, do not invent commands or report CLI validation as having run. Skills require an available `planlet` executable; with no executable and no working install path, stop and report naming the missing executable instead of hand-managing planlet files. The CLI-unavailable fallback is retired (2026-08-05).

## Working rules

- Inspect the repository before proposing or implementing changes.
- Target exactly one planlet per mutating implementation or completion workflow.
- Read both planlet files from disk at the start of implementation; do not rely on conversation memory.
- Keep `plan.md` and `tasks.md` consistent when scope or approach changes.
- Preserve stable IDs for unchanged tasks. Assign new IDs above the highest existing numeric suffix.
- Mark a task complete only after its implementation and relevant verification succeed.
- Keep `plan.md` verification as strategy. Do not copy routine command results into planlet files; the repository suite, review, and CI already hold them. Record a `## Verification Evidence` note only for a durable fact ordinary history cannot reconstruct, and keep every recorded line write-once: no current-head SHA, moving link, bare run ID, log, or local path.
- Keep task checkboxes current as work progresses, not only at the end.
- Treat material plan drift, new scope, failed verification, and ambiguous tasks explicitly; do not guess through them.
- Do not complete a planlet with unchecked tasks without explicit user confirmation and a recorded reason.
- Preserve user changes and avoid unrelated edits.
- Prefer small, reviewable changes aligned with the current planlet.

## Pull requests

When creating a pull request against this repository, structure the description with [`.github/pull_request_template.md`](.github/pull_request_template.md). Keep it proportional to the change, remove sections that do not apply, and check only the verification commands actually run. The template’s contributor checklist already includes the `CHANGELOG.md` → `Unreleased` item.

A pull request that finishes a planlet task must also carry that task’s `- [x]` in
`plans/<slug>/tasks.md`. Run `planlet --root "<repository-root>" task check <slug> <task-id>`
before opening the PR and include the resulting `tasks.md` change in the same branch. An
implementation PR that merges with its own task still unchecked is an incomplete PR, not a
deferred bookkeeping item.
When a PR checks the last unchecked task of a plan, also run
`node dist/planlet.mjs --root . complete <slug>` before opening the PR so the plan archives to
`plans/completed/`.

## Changelog

A changelog entry is REQUIRED when a change is user-visible product, Planlet
CLI (`planlet`), or published-skill behavior: update [`CHANGELOG.md`](CHANGELOG.md)
under `[Unreleased]` in the same change set. The entry is optional only for
chore, internal-only, or contributor-doc-only work, and for repository-local
maintainer tooling under `scripts/` (for example `release.mjs` and
changelog-release helpers); skip it and say so in the PR. Those scripts are not
published product surface; document operator-facing script changes in
[`RELEASING.md`](RELEASING.md) instead. Format and release-cut procedure live
there; do not duplicate them here.

## Planlet file conventions

- Slugs use lowercase ASCII letters, digits, and single hyphens and must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- The canonical filenames are `plan.md` and `tasks.md`.
- Each file starts with an H1 title.
- Recognized tasks use `- [ ] T<number> Description` or `- [x] T<number> Description`.
- Task IDs are unique and stable; reordering tasks must not renumber them.
- Active planlets live directly under `plans/`; completed planlets use `<YYYY-MM-DD>-<slug>` archive names under `plans/completed/`.
- Never overwrite an existing active or completed planlet silently.

## Installed skill copies are committed on purpose

`skills/` holds the canonical skill sources. `.claude/skills/planlet-*`, `.agents/skills/planlet-*`, and their `.planlet-manifest.json` files are copies that `planlet init` and `planlet update` generate from it, and they are **intentionally tracked in git**.

Yes, this duplicates content. Do not gitignore or delete these copies to remove the duplication. The repository dogfoods its own skills: a fresh clone must have working skills before anyone can run `npm install`, build the CLI, and regenerate them. Ignoring them creates a bootstrap gap.

Regenerate them with `node dist/planlet.mjs update` after changing anything under `skills/`, and commit the result. `planlet tools` reporting every destination as `installed` means the tracked copies match the canonical sources.

## Rejected simplifications

Each item below has been proposed and declined more than once. Simpler is the
right instinct; these are the cases where the simpler version was measured
against a specific failure and lost. Read the named threat before proposing the
cut again, and if you still think it should go, say which threat you are
accepting rather than restating the line count.

- **Lock ownership token + rename-aside release** (`src/core/planlet-lock.ts`). Not PID-reuse insurance — a dead process never releases. The token makes the recovery our own error text invites survivable: a user who removes a lock that turned out to be live lets a second holder in, and a read-then-unlink release would delete that holder's lock mid-write. Release renames aside and deletes only on a matching quarantined token.
- **No automatic stale-lock reclaim.** Remove-then-create admits two writers on one dead holder. Manual removal only, until `flock(2)`/`LockFileEx`.
- **Hashed lock-directory name.** A readable encoding of the checkout path exceeds the 255-byte filename limit on deep checkouts and publishes the user's directory layout into a world-readable `/tmp`.
- **Release-failure warning plumbing** (`OwnedLockRunResult.releaseWarning`). A lock that outlives a _successful_ operation silently wedges the next run. Letting it throw turns success into failure; catching at the CLI boundary cannot tell whether the operation ran.
- **Structured double-fault error.** When the operation and the release both fail, the operation's code and the lock path must survive. A bare `AggregateError` reaches the CLI as `internal_error` with nothing to act on, and `src/core/` writes no output, so stderr is not an alternative.
- **Lock dependency injection** (`write`, `rename`, `remove`, `pid`). The seams for the acquire-failure and release-failure tests. Removing them removes those tests.
- **`transactionHooks`** (`src/core/harness/harness-installer.ts`, marked `@internal`). The rollback, recovery-directory, and cleanup-warning paths are unreachable through the public API. Three steps, one per distinct outcome.
- **`--release-date`** (`scripts/assert-changelog-release-ready.mjs`, ordinary lint only). The kit (`todayUtc()`) owns the cut date for releases, so `RELEASING.md` no longer documents `--release-date` for normal releases. The helper keeps its ordinary no-flag cardinality/valid-date/link-ref lint that `ci.yml` invokes as `node scripts/assert-changelog-release-ready.mjs`, plus the historical `--verify-release` path that human tooling can call. The duplicate-flag pre-scan stays — silent last-wins would still ship the wrong date if the flag were ever reintroduced.
- **Interactive `init` tool selector** (`src/cli.ts`). Kept deliberately: the first-run destination prompt was a product decision (2026-08-04, completed plan `plans/completed/2026-07-27-interactive-init-tool-selection/`), not accidental hand-rolled TTY machinery. `--tools` covers every non-interactive path but does not replace the prompt; reviews proposing the cut must say which threat they accept.

## Architecture and implementation direction

Follow the design's recommended TypeScript and Node.js architecture unless an approved planlet changes it. Keep domain logic independent from CLI argument parsing and output rendering. Prefer Node built-ins, minimal runtime dependencies, deterministic output, structured errors, safe path resolution, and atomic writes.

Keep skills portable across agent harnesses. Canonical skill instructions must describe capabilities and outcomes without depending on vendor-specific tools. Harness-specific adapters should remain thin and generated from canonical sources when that phase is implemented.

External projects, including OpenSpec, may inform high-level workflow ideas. Write Planlet behavior and instructions independently; do not copy external skill wording, examples, command sequences, or product-specific mechanics.

## Verification expectations

Run checks in proportion to the change and report exactly what ran. When relevant tooling does not exist yet, perform available structural and content checks and disclose the limitation.

For Markdown-only work:

- Confirm referenced local paths exist.
- Check planlet filenames, headings, task syntax, and unique task IDs.
- Run `git diff --check`.
- After writing or editing a planlet file, confirm the diff contains only the intended content — no leaked tool-output markup or other unintended trailing text.

For code work, run the repository commands below. Do not add guessed commands to this guide; update it when real commands are introduced.

## Repository commands

Node.js 22 or newer. Install dependencies with `npm install`.

| Command                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `npm run format`       | Rewrite supported files with Prettier.                    |
| `npm run format:check` | Fail on files that do not match Prettier style.           |
| `npm run lint`         | Run ESLint over source files, tests, and maintainer scripts. |
| `npm run knip`         | Detect unused files, dependencies, exports, and unlisted binaries. |
| `npm run type-check`   | Run `tsc --noEmit`.                                       |
| `npm run build`        | Bundle the CLI to `dist/planlet.mjs`.                     |
| `npm test`             | Run the TypeScript test suite via `tsx` atop `node:test`. |

Full verification suite, in order:

```sh
npm run format:check
npm run lint
npm run knip
npm run type-check
npm run build
npm test
git diff --check
git status --porcelain   # expect empty; build output is gitignored
```

The built CLI runs as `node dist/planlet.mjs <command>`.

`.github/workflows/ci.yml` runs this same suite on ubuntu, macos, and windows
against Node 22 and 24, plus a ubuntu/Node-22-only step that regenerates
installed skill copies and fails on drift. Workflow files are covered by `format:check`.

## Changelog and release maintenance

Release and changelog guidance lives in [`RELEASING.md`](RELEASING.md); release
gates and workflow contract live in
[`plans/completed/2026-08-03-release-automation/plan.md`](plans/completed/2026-08-03-release-automation/plan.md). Do not
publish, create release tags, or configure trusted publishing without the
captain decisions required by that plan.

## Maintaining this guide

Update `AGENTS.md` when the repository gains stable commands, important top-level structure, or agent-specific constraints. Prefer links to authoritative files over duplicating material that can drift.

<!-- BEGIN PLANLET AGENTS v:1 hash:0246f0e7 -->
## Planning with Planlet

This repository uses Planlet for focused implementation plans. A planlet is
`plans/<slug>/plan.md` + `tasks.md`; Markdown is the source of truth.

- Propose a planlet before multi-step work; skip it for one-file changes.
- Use the `planlet` CLI for lifecycle state, including task checkboxes and
  completion/archive. Edit plan and task body content directly.
  Commands: `planlet create|show|tasks|status|validate <slug>`,
  `planlet task check <slug> <task-id>`, `planlet complete <slug>`.
- Check each task off only after its verification passes. When the last task is
  checked, run `planlet complete <slug>` to archive it.
- Run `planlet help [command]` before using a command you have not used here.
- The `planlet` CLI is required. If no executable is available, install it
  (`npm install -g @vipentti/planlet`) or invoke it through
  `npx @vipentti/planlet`. If it still cannot run, stop and report that,
  naming the missing executable. Do not reimplement CLI operations by editing
  planlet files.
<!-- END PLANLET AGENTS -->

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

When a described CLI capability is not yet present, do not invent commands or report CLI validation as having run. Follow the manual fallback specified by `planlet_design.md` and the selected planlet, and state explicitly when fallback behavior was used and which deterministic CLI checks were unavailable.

## Working rules

- Inspect the repository before proposing or implementing changes.
- Target exactly one planlet per mutating implementation or completion workflow.
- Read both planlet files from disk at the start of implementation; do not rely on conversation memory.
- Keep `plan.md` and `tasks.md` consistent when scope or approach changes.
- Preserve stable IDs for unchanged tasks. Assign new IDs above the highest existing numeric suffix.
- Mark a task complete only after its implementation and relevant verification succeed.
- Keep `plan.md` verification as strategy. Summarize command results in `tasks.md` only when they are material, failed, partial, unavailable, or externally governed, using short lines with immutable commit SHAs and full stable URLs. Never paste logs or moving identifiers.
- Keep task checkboxes current as work progresses, not only at the end.
- Treat material plan drift, new scope, failed verification, and ambiguous tasks explicitly; do not guess through them.
- Do not complete a planlet with unchecked tasks without explicit user confirmation and a recorded reason.
- Preserve user changes and avoid unrelated edits.
- Prefer small, reviewable changes aligned with the current planlet.

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

| Command | Purpose |
| --- | --- |
| `npm run format` | Rewrite supported files with Prettier. |
| `npm run format:check` | Fail on files that do not match Prettier style. |
| `npm run lint` | Run ESLint over `src/` and `tests/`. |
| `npm run type-check` | Run `tsc --noEmit`. |
| `npm run build` | Bundle the CLI to `dist/planlet.mjs`. |
| `npm test` | Run the TypeScript test suite via `tsx` atop `node:test`. |

Full verification suite, in order:

```sh
npm run format:check
npm run lint
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

## Maintaining this guide

Update `AGENTS.md` when the repository gains stable commands, important top-level structure, or agent-specific constraints. Prefer links to authoritative files over duplicating material that can drift.

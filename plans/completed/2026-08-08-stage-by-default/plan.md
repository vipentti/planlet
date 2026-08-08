# Stage planlet-written files by default

## Summary

`planlet task check` / `task uncheck` and `complete` stage exactly the plan
files they write or rename, by default, via explicit-path `git add` when the
selected Planlet root is inside a git working tree. `complete` stages the
archived destination and removes the source from the index. The change mirrors
the existing `init`/`update` agent-file staging precedent
(`src/core/harness/agent-snippet.ts:197-257`) and reconciles the design doc,
which still bans CLI staging (`planlet_design.md:1004`, 2026-07-22) with
behavior that has shipped since 2026-08-05.

## Scope

- Amend `planlet_design.md` §18 (lines ~994 and ~1004) to record the qualified
  rule: the CLI stages exactly the paths it wrote or renamed with explicit-path
  `git add`, gated on a git marker, warning (never failure) on git errors, never
  `git add -A`, never commits, never inspects working-tree cleanliness.
- Update `README.md` so the staging behavior is documented for the data-file
  commands, alongside the existing `init`/`update` statement (~line 100).
- Extract a shared git helper `src/core/git.ts` (`tryStage` + `tryStageMove`,
  warning-on-failure shape) from `agent-snippet.ts:197-257`; rewire
  `agent-snippet.ts` onto it. No new dependency.
- Call sites:
  - `src/core/plan/task-update.ts` — after a changed write, stage
    `plans/<slug>/tasks.md`; skip when `changed: false`.
  - `src/core/plan/planlet-completion.ts` — after the move, stage with
    move-specific index operations: `git add -- <destination>` then
    `git rm --cached --ignore-unmatch -r -- <source>`.
- Git-marker detection walks from the selected root toward the filesystem root,
  so an explicit `--root` package subdirectory inside a parent worktree is
  recognized; zero git calls when no marker exists anywhere above the root.
- Staging is unconditional in git roots, gated only on the git marker; every
  call site goes through the shared guard in `src/core/git.ts`.
- Tests in `tests/integration/`: `task-update.test.ts`, `completion.test.ts`,
  using the shared `withGitRoot` / `porcelain` fixtures.
- `CHANGELOG.md` `[Unreleased]` `### Added` entry.

Out of scope:

- `planlet create` writes H1 scaffold stubs and does not stage them; the plan
  skill replaces those stubs with approved content, so create leaves the index
  alone.
- No `git add -A`, no commits, no clean-tree inspection, no staging of files
  the command did not write.
- No behavior change to `init`/`update` agent-file staging (keeps its current
  gating and warnings; `--no-agents` unchanged).
- No change to the per-planlet write lock, atomic publish/move, or fault
  injection seams. No git library dependency (package keeps zero runtime deps).

## Revision (2026-08-08) — captain decisions

- The originally planned `--no-stage` escape hatch on `task check|uncheck` and
  `complete` was dropped by captain decision 2026-08-08; staging is
  unconditional in git roots, and there is no escape hatch.
- Staging of `create` H1 stubs was dropped in final review: the stubs are
  transient and immediately replaced by the plan skill, so staging them could
  commit stale bytes. `create` never stages.
- Completion staging is move-specific (destination add + source `git rm
  --cached --ignore-unmatch`) so a planlet that was never tracked still stages
  its destination without a warning.
- Git-marker detection walks parent directories so explicit package roots inside
  a parent worktree stage correctly.

## Approach

Staging runs after the existing atomic publish / move, inside the write lock
(safe: the lock lives in the OS temp directory, outside the repository). For
`task check` / `task uncheck`, one explicit `git add -- plans/<slug>/tasks.md`.
For `complete`, stage the destination explicitly and remove any source index
entries with `git rm --cached --ignore-unmatch -r`; the `--ignore-unmatch`
keeps a never-tracked source a success, and git still detects the `plan.md`
rename from the staged delete-plus-add pair. Scope stays to the planlet's own
paths — an unrelated dirty file remains unstaged.

Gate every call on a git-marker walk (lstat of `.git` at the root and each
ancestor; works for regular checkouts, worktree `.git` files, and nested
package roots). In non-git roots, zero git calls. Git errors become warnings
appended to the existing warnings array, never a failed command.

## Acceptance Criteria

- In a git root, `task check` / `task uncheck` stage exactly
  `plans/<slug>/tasks.md`; an already-satisfied (unchanged) update stages
  nothing.
- In a git root, `complete` stages the moved planlet: destination added and
  source removed from the index, git reporting the `plan.md` rename when
  similarity allows; an unrelated dirty file stays unstaged.
- `complete` succeeds without a staging warning for a planlet that was never
  tracked or staged, and clears old index entries for a staged-but-uncommitted
  planlet.
- A `task check` under an explicit package `--root` inside a parent git
  worktree stages `packages/<pkg>/plans/<slug>/tasks.md` in the parent repo;
  unrelated parent and package changes stay unstaged.
- In a non-git root, no command runs git; output matches current behavior.
- A git failure produces a warning and exit code 0.
- `planlet_design.md` §18 records the qualified rule and no longer contradicts
  shipped behavior; `README.md` documents data-file staging and that `create`
  does not stage.
- `CHANGELOG.md` `[Unreleased]` carries an `### Added` entry for the change.
- Full suite passes (see Verification).

## Verification

Strategy only, not a run log. Run the full repository suite in order —
`npm run format:check`, `npm run lint`, `npm run knip`, `npm run type-check`,
`npm run build`, `npm test`, `git diff --check`, and confirm a clean porcelain.
New integration tests exercise the staging behavior in real git roots using
the shared `withGitRoot` / `porcelain` test fixtures: scoped staging per
command, all three completion source states (tracked, staged-but-uncommitted,
never tracked), nested-root staging inside a parent worktree, non-git root (no
git call), and git-failure-as-warning.

Before opening the PR, run `planlet task check <slug> <task-id>` on this
planlet's own task per `AGENTS.md`, and run `planlet complete stage-by-default`
once the last task is checked. No `## Verification Evidence` note is expected:
all verification is reconstructable from the test suite, review, and CI.

## Risks and Considerations

- `planlet_design.md:1004` originally said the opposite; amending it is the one
  non-negotiable step. Shipping code without it leaves the authoritative design
  doc lying.
- `complete` staging includes any pre-existing user edits inside the moved
  planlet directory; acceptable because the directory is archived wholesale.
- Untracked-planlet scenarios: staging only applies within git roots; non-git
  roots keep today's behavior.

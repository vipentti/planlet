# Stage planlet-written files by default

## Summary

`planlet task check` / `task uncheck`, `complete`, and `create` stage exactly
the plan files they write or rename, by default, via explicit-path `git add`
when the repository uses git. `--no-stage` opts out per command. The change
mirrors the existing `init`/`update` agent-file staging precedent
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
- Extract a shared git helper `src/core/git.ts` (`hasGitMarker` + `stageFile`,
  warning-on-failure shape) from `agent-snippet.ts:197-257`; rewire
  `agent-snippet.ts` onto it. No new dependency.
- Call sites:
  - `src/core/plan/task-update.ts` — after a changed write, stage
    `plans/<slug>/tasks.md`; skip when `changed: false`.
  - `src/core/plan/planlet-completion.ts` — after the move, one call with
    `<source-dir> <dest-dir>` (both already computed as `source` /
    `destination`).
  - `src/core/plan/creation.ts` — stage the new `plans/<slug>/` directory so a
    later `task check` on a fresh planlet does not half-stage (removes the
    partial-staging wrinkle).
- `--no-stage` boolean flag on `task check|uncheck`, `complete`, `create`,
  plumbed through `src/cli.ts` command tables and `src/commands/*` handlers.
- Tests in `tests/integration/`: `task-update.test.ts`, `completion.test.ts`,
  `creation.test.ts` using the `withGitRoot` + `stagedFiles` pattern.
- `CHANGELOG.md` `[Unreleased]` `### Added` entry.

Out of scope:

- No `git add -A`, no commits, no clean-tree inspection, no staging of files
  the command did not write.
- No behavior change to `init`/`update` agent-file staging (keeps its current
  gating and warnings; `--no-agents` unchanged).
- No change to the per-planlet write lock, atomic publish/move, or fault
  injection seams. No git library dependency (package keeps zero runtime deps).

## Approach

Mirror the agent-file precedent exactly. Staging runs after the existing atomic
publish / move, inside the write lock (safe: the lock lives in the OS temp
directory, outside the repository). For `complete`, use one combined pathspec
call `git add <source-dir> <dest-dir>`: explicit deleted-file paths fail
(rc=128, "pathspec did not match"), while the source directory pathspec covers
the recursive deletion and git reports the `plan.md` rename from the staged
delete-plus-add pair. Scope stays to the planlet's own paths — an unrelated
dirty file remains unstaged.

Gate every call on `hasGitMarker(repositoryRoot)` (lstat on `.git`; works in
worktrees where `.git` is a regular file). In non-git roots, zero git calls.
Git errors become warnings appended to the existing warnings array, never a
failed command. `--no-stage` is a pure boolean that skips the git call; it does
not change what was written.

Verified git facts (scout report §3, reproduced in a lab repo): source-directory
pathspec required for the completion delete side; combined source+dest call
stages both sides; worktree `.git` file passes the lstat gate.

## Acceptance Criteria

- In a git root, `task check` / `task uncheck` stage exactly
  `plans/<slug>/tasks.md`; `--no-stage` leaves it unstaged; an already-satisfied
  (unchanged) update stages nothing.
- In a git root, `complete` stages the moved planlet on both sides and git
  reports the `plan.md` rename; an unrelated dirty file stays unstaged;
  `--no-stage` leaves everything unstaged.
- In a git root, `create` stages the new `plans/<slug>/` directory.
- In a non-git root, no command runs git; output matches current behavior.
- A git failure produces a warning and exit code 0.
- `planlet_design.md` §18 records the qualified rule and no longer contradicts
  shipped behavior; `README.md` documents data-file staging.
- `CHANGELOG.md` `[Unreleased]` carries an `### Added` entry for the change.
- Full suite passes (see Verification).

## Verification

Strategy only, not a run log. Run the full repository suite in order —
`npm run format:check`, `npm run lint`, `npm run knip`, `npm run type-check`,
`npm run build`, `npm test`, `git diff --check`, and confirm a clean porcelain.
New integration tests exercise the staging behavior in real git roots using the
existing `withGitRoot` + `stagedFiles` pattern
(`tests/integration/harness-installation.test.ts:83-106`): scoped staging per
command, `--no-stage`, non-git root (no git call), and git-failure-as-warning.

Before opening the PR, run `planlet task check <slug> <task-id>` on this
planlet's own task per `AGENTS.md`, and run `planlet complete stage-by-default`
once the last task is checked. No `## Verification Evidence` note is expected:
all verification is reconstructable from the test suite, review, and CI.

## Risks and Considerations

- `planlet_design.md:1004` currently says the opposite; amending it first is the
  one non-negotiable step. Shipping code without it leaves the authoritative
  design doc lying.
- `complete` staging includes any pre-existing user edits inside the moved
  planlet directory; acceptable because the directory is archived wholesale.
- `create` staging is included on purpose (scout §3): without it, `task check`
  on a freshly created, still-untracked planlet stages only `tasks.md`,
  half-staging the planlet.
- Untracked-planlet scenarios in general: staging only applies within git roots;
  non-git roots keep today's behavior.

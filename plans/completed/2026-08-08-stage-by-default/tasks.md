# Tasks: Stage planlet-written files by default

- [x] T1 Amend `planlet_design.md` §18 to record the qualified staging rule (explicit-path `git add` only, git-marker gated, warning never failure, no `git add -A`, no commits, no clean-tree inspection) replacing the current plain-move / index-is-user's-responsibility wording, and update `README.md` to document that `task check` / `task uncheck` and `complete` stage the files they write when the repository uses git.
- [x] T2 Extract `hasGitMarker` and `stageFile` from `src/core/harness/agent-snippet.ts:197-257` into a shared `src/core/git.ts` module (warning-on-failure shape), rewire `agent-snippet.ts` onto it, and keep `init`/`update` behavior unchanged.
- [x] T3 Add staging call sites gated on the git marker: after a changed `tasks.md` write in `src/core/plan/task-update.ts`, and after the move in `src/core/plan/planlet-completion.ts` (move-specific index staging: `git add -- <destination>` then `git rm --cached --ignore-unmatch -r -- <source>`), through the shared git guard with git failures becoming warnings.
- [x] T4 Extend integration tests with the shared `withGitRoot` / `porcelain` fixtures in `tests/integration/task-update.test.ts` and `completion.test.ts`: scoped staging per command (unrelated dirty file stays unstaged), all three completion source states (tracked, staged-but-uncommitted, never tracked), nested-root staging inside a parent worktree, no-op writes skip staging, no git call in a non-git root, and git failure yields a warning with exit code 0.
- [x] T5 Add a `CHANGELOG.md` `[Unreleased]` `### Added` entry for default scoped staging of planlet-written files, then run the full repository suite (`format:check`, `lint`, `knip`, `type-check`, `build`, `test`, `git diff --check`, clean porcelain) and mark this task complete only after it passes.

## Completion

- Completed at: 2026-08-08T11:17:43.339Z
- Mode: normal

## Follow-up (2026-08-08)

The originally planned `--no-stage` escape hatch was dropped by captain
decision before merge; staging is unconditional in git roots, gated only on
the git marker, and the flag and its `stage: false` tests were removed.

Final review round (2026-08-08): `create` staging of H1 stubs was dropped
(the stubs are transient, replaced by the plan skill, and staging them could
commit stale bytes); completion staging became move-specific with `git rm
--cached --ignore-unmatch` so never-tracked planlets stage without a warning;
and git-marker detection now walks parent directories so explicit package
roots inside a parent worktree stage correctly.

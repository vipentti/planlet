# Launch Readiness

## Summary

Close code-level 0.1.0 launch blockers: per-planlet write locks, validation
hardening, transactional harness install, unselected harness path resolution,
CLI internal-error boundary, CI action pinning, and local release-prep gates.
Leave external publish, visibility, tags, and Slice B `release.yml` to the
existing `release-automation` planlet and captain actions.

## Scope

In scope:

- Per-planlet cross-process locks for `task check`, `task uncheck`, and
  `complete`, with ownership-token-safe release. Dead holders are not
  reclaimed automatically; manual removal is the only recovery path.
- Skip destructive completion audit rollback after a failed move; report
  partial failure and rely on resume.
- Treat completed + normal mode + unchecked tasks as `invalid_plan`.
- Destination-level transactional harness install/update with rollback.
- Resolve only selected harness destinations before `resolveSafePath`.
- Production `internal_error` boundary in `src/index.ts` with optional debug.
- Pin CI Actions to commit SHAs; add Dependabot for GitHub Actions.
- Changelog date gate / Unreleased placeholder policy for unpublished 0.1.0.
- Design-doc update for concurrency locks; README bootstrap procedure clarity.
- Tests for locks, validation, harness transaction, and CLI boundary.

Out of scope:

- npm publish, tags, GitHub releases, visibility, trusted publisher.
- Landing `.github/workflows/release.yml` on `main` (Slice B).
- Marking external `release-automation` tasks complete.
- `handleValidate` style cleanup, tasks.md symlink rejection.
- Deleting ownership-token / quarantine reclaim in favor of mkdir-only locks.

## Approach

1. Add `src/core/planlet-lock.ts`: exclusive per-slug lock holding PID
   metadata, `write_conflict` on any contention (live or dead holder),
   release in `finally`. Locks were originally planned under
   `plans/.planlet-locks/<slug>`; they live in the OS temp directory instead,
   in a namespace keyed by owner and canonical repository root, so a transient
   holder file never appears in `git status` or an editor tree.
2. Wrap `updateTask` and `completePlanlet` critical sections with the lock.
   On move failure after audit publish, leave audit in place and surface
   `auditRecorded: true` without rewriting `tasks.md`.
3. Promote normal+unchecked completed validation from warning to throw.
4. Stage all managed skills + manifest, swap with pre-commit rollback, and
   never roll back after the manifest commit point; leave cleanup leftovers
   with warnings. Coalesce safe unselected aliases that resolve to the same
   physical destination; ignore escaping unselected paths.
5. Catch unexpected errors at `src/index.ts`; add `internal_error` code;
   expose details only when `PLANLET_DEBUG=1`.
6. Pin `ci.yml` actions; add `.github/dependabot.yml`; ordinary CI changelog
   gate plus explicit `--release-date` release verification.
7. Lock release uses ownership tokens and atomic quarantine rename so a
   late or duplicate release cannot delete a successor's live lock. There is
   no automatic stale-lock reclaim: remove-then-create admits two writers on
   one dead holder, so confirmed manual removal is the only recovery until
   `flock(2)`/`LockFileEx` is available.
8. Surface harness recovery `next` at the PlanletError top level; emit harness
   cleanup and lock-release warnings as stderr diagnostics; discover changelog
   headings broadly then validate syntax; collapse lock wrappers and apply
   safe line cuts without weakening release ownership checks.

## Acceptance Criteria

- Concurrent task updates and task-vs-complete races fail with `write_conflict`
  without lost checkbox updates.
- Lock released after thrown operations; release failures surface as
   warnings or structured double-fault errors; a dead holder blocks with
   `write_conflict` until manually removed; release never deletes a
   successor's lock.
- Failed complete move after audit leaves audit and does not clobber tasks.
- Completed normal+unchecked is `invalid_plan` in API and compiled CLI.
- Partial harness install failure restores exact pre-operation managed state.
- `init --tools agents` ignores an escaping unselected `.claude/skills`.
- Unexpected CLI errors emit structured `internal_error` without stacks by
  default; debug mode can show diagnostics.
- CI actions pinned; Dependabot configured; changelog cannot publish a stale
  past 0.1.0 date without an explicit update step.
- No `release.yml` on `main`; no external publish performed.

## Verification

- Focused unit/integration tests per finding (deterministic barriers or
  injected lock/fault seams).
- Full suite: `format:check`, `lint`, `type-check`, `build`, `test`,
  `git diff --check`, skill update parity, `npm pack --dry-run`,
  `npm publish --dry-run`.
- Compiled CLI coverage for validation and internal_error paths.

## Risks

- Windows lock and directory-rename behavior under AV.
- Editors/git can still edit `tasks.md` outside the CLI lock.
- External captain gates remain before claiming publish-ready.

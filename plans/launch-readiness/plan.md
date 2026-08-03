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
  `complete`, with safe stale-lock reclaim only for dead holders.
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

1. Add `src/core/planlet-lock.ts`: exclusive lock directory under
   `plans/.planlet-locks/<slug>`, PID metadata, reclaim only if holder PID is
   dead, `write_conflict` on live contention, release in `finally`.
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
7. Lock reclaim uses ownership tokens and atomic quarantine rename so two
   reclaimers cannot delete each other's live lock.
8. Surface harness recovery `next` at the PlanletError top level; emit harness
   cleanup and lock-release warnings as stderr diagnostics; discover changelog
   headings broadly then validate syntax; collapse lock wrappers and apply
   safe line cuts without weakening reclaim.

## Acceptance Criteria

- Concurrent task updates and task-vs-complete races fail with `write_conflict`
  without lost checkbox updates.
- Lock released after thrown operations; dead-holder reclaim works; live
  holders are not stolen.
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

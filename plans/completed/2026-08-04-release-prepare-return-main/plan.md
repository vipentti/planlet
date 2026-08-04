# Prepare returns to main after PR

## Summary

After a successful `prepare --execute` PR create, check out local `main` so the
operator can fast-forward once the release PR merges, without a manual branch
switch.

## Scope

### Goal

End a successful `prepare` on local `main` (same tip as at start — release work
stayed on `release/v<version>`). Dry-run announces the checkout. Docs and the
prepare e2e test match.

### Non-goals

- Restoring a non-`main` starting branch or detached HEAD.
- Deleting the local or remote release branch.
- Auto-pull / fast-forward after merge; `tag` behavior; resume/repair of
  partial prepare.
- Changing prepare guards, commit, push, or PR-create logic beyond the trailing
  checkout.

## Approach

1. After `gh pr create` succeeds in `cmdPrepare`, run `git checkout main`.
2. On checkout failure: exit non-zero with a message that the PR already exists
   and checkout failed — same no-resume contract; no auto-repair.
3. Dry-run plan includes a line that prepare would check out `main` after PR
   create.
4. Update `RELEASING.md` Prepare wording: successful execute leaves the
   checkout on `main`; after merge, update local `main` to the remote tip, then
   `tag`.
5. No `CHANGELOG.md` entry — `scripts/release.mjs` is repository-local
   maintainer tooling, not published Planlet CLI surface (see `AGENTS.md`).

Always checkout `main` (not “restore starting branch”): prepare already
requires `HEAD == origin/main` tip, and the fast-forward workflow is on `main`.

## Acceptance Criteria

- Successful `prepare --execute` leaves the current branch `main` with a clean
  worktree; local `main` tip is unchanged from before the release commit.
- Dry-run prints the planned post-PR `main` checkout and mutates nothing.
- Checkout failure after PR create fails closed with recovery guidance (PR
  already open).
- `RELEASING.md` reflects the behavior; `CHANGELOG.md` Unreleased stays empty
  for this change.

## Verification

- Extend `tests/integration/release-utility.test.ts`: e2e prepare asserts
  current branch is `main`; dry-run stdout mentions checkout of `main`.
- Full suite: `npm run format:check`, `lint`, `type-check`, `build`, `npm test`,
  `git diff --check`.
- No `## Verification Evidence` expected; ordinary test/CI history suffices.

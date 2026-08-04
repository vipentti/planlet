# Tasks: Prepare returns to main after PR

- [x] T1 After successful `gh pr create` in `cmdPrepare`, run `git checkout main`; dry-run plans that step; on checkout failure exit non-zero naming the open PR and that manual recovery is required
- [x] T2 Extend prepare dry-run and e2e tests so dry-run stdout mentions checkout of `main` and successful execute leaves the current branch on `main`
- [x] T3 Update `RELEASING.md` Prepare operator wording and add a `CHANGELOG.md` Unreleased note for the post-PR return to `main`

## Completion

- Completed at: 2026-08-04T06:41:15.021Z
- Mode: normal

# Tasks: Add read-only check-completion CI gate

- [x] T1 Export a failing-on-error read-only git helper from `src/core/git.ts` that resolves `--base` with `git rev-parse --verify --end-of-options <base>^{commit}`, then runs `git diff --name-only --relative -z <oid>...HEAD -- plans/` and NUL-splits paths.
- [x] T2 Add core check-completion selection (unique touched active slugs, `ready_to_complete` violations, no violate on active/completed slug collision) and a thin `src/commands/check-completion.ts` handler that remaps violations to exit 4.
- [x] T3 Wire `planlet check-completion --base <git-ref>` in `src/cli.ts` with usage, help, and `git_error`. No `--head`.
- [x] T4 Cover slug extraction, nested-root `--relative` paths, unique vs collided violation selection, usage, git failures, ready-touched, completed-in-range, symbolic `--base` echoed in `base`, and porcelain-unchanged cases in unit and `withGitRoot` tests.
- [x] T5 Document the command in `README.md`, `planlet_design.md` §13.2 and §8.5, new `git_error` in §13.5, and `CHANGELOG.md` `[Unreleased]`.

## Completion

- Completed at: 2026-08-15T15:52:56.851Z
- Mode: normal

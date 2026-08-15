# Tasks: Add read-only check-completion CI gate

- [ ] T1 Export a failing-on-error read-only git name-only diff helper from `src/core/git.ts` for `<base>...<head>` plus a `plans/` pathspec.
- [ ] T2 Add core check-completion selection (touched active slugs, `ready_to_complete` violations) and a thin `src/commands/check-completion.ts` handler that remaps violations to exit 4.
- [ ] T3 Wire `planlet check-completion --base <git-ref> [--head <git-ref>]` in `src/cli.ts` with usage, help, and `git_error`.
- [ ] T4 Cover slug extraction, violation selection, usage, git failures, ready-touched, completed-in-range, and porcelain-unchanged cases in unit and `withGitRoot` tests.
- [ ] T5 Document the command in `README.md`, `planlet_design.md` §13.2 and §8.5, and `CHANGELOG.md` `[Unreleased]`.

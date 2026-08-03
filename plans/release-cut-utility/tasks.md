# Tasks: Release-cut maintainer utility

- [ ] T1 Add `scripts/release.mjs` with `prepare` and `tag` subcommands, shared
      argv (`--version`, `--release-date`, `--execute`, `--help`), `tag`-only
      `--push`, dry-run default, and clear stderr errors with no mutations
      without `--execute`
- [ ] T2 Implement `prepare` file phase: clean-tree and `HEAD == origin/main`
      prechecks, changelog cut, package/lock version alignment, assert
      `--release-date`, and `changelog.mjs` smoke
- [ ] T3 Implement `prepare` git/GitHub phase: branch `release/v<version>`,
      signed commit `release: <version>` with only release files, push branch,
      `gh pr create` into `main` with no auto-merge; fail closed on signing/`gh`
      /existing branch-or-PR problems
- [ ] T4 Implement `tag`: clean-tree, `origin/main` ancestry, version match,
      `git tag -a -s`, optional `git push` only with `--push` + `--execute`;
      hard-refuse force/delete/unsigned/publish and invalid `--push` usage
- [ ] T5 Add `release:prepare` and `release:tag` scripts to `package.json`;
      update `RELEASING.md` for prepare → review/merge → tag[`--push`] without
      duplicating workflow internals
- [ ] T6 Add fixture/subprocess tests for dry-run purity, successful prepare file
      cut, assert failures, and tag-path refusals; stub or skip live `gh`/push
      paths in CI
- [ ] T7 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work

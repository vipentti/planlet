# Tasks: Release-cut maintainer utility

- [ ] T1 Add `scripts/release.mjs` with `prepare` and `tag` subcommands; shared
      argv (`--version`, `--release-date`, `--execute`, `--help`); `tag`-only
      `--push`; strict/duplicate-flag rejection; dry-run default; clear stderr
      errors naming the failed operation; no worktree, local-ref, or remote-write
      mutations without `--execute`
- [ ] T2 Implement shared remote-read helpers and dry-run purity: `git ls-remote`
      for remote `main` and exact tag/branch refs; document/enforce mutation
      classes; dry-run never `git fetch` or falsely claims ancestry when unproven;
      `--execute` fetches explicitly before mutating
- [ ] T3 Implement `prepare` file phase after prechecks: clean-tree, remote-main
      identity, version/`--release-date` (default today UTC), changelog cut,
      package/lock alignment, assert with that date, `changelog.mjs` smoke
- [ ] T4 Implement `prepare` git/GitHub phase with recovery state machine: expected
      signed commit on `release/v<version>`; push; `gh pr create` with no
      auto-merge; resume PR-only when remote tip matches expected commit; refuse
      divergent branch/PR; report existing matching PR without duplicate; never
      delete/force-update branches
- [ ] T5 Implement `tag`: resolve `--release-date` from changelog section by
      default (explicit value must match); assert with resolved date; clean-tree;
      remote-main ancestry; exact remote tag collision via `ls-remote` before any
      local tag; `git tag -a -s`; optional `--push`; refuse
      force/delete/unsigned/publish and recreating colliding tags
- [ ] T6 Add `release:prepare` and `release:tag` scripts to `package.json`; update
      `RELEASING.md` for prepare → review/merge → tag[`--push`], changelog-derived
      tag dates, prepare resume-after-push, and dry-run remote-read semantics
- [ ] T7 Add fixture/subprocess tests (temp repos, bare remotes, stubbed `gh` /
      signing): dry-run purity; prepare cut; assert failures; push-ok/PR-fail then
      successful rerun; divergent same-name branch refused; matching PR
      idempotence; remote-only tag collision; tag on a UTC day later than prepare
- [ ] T8 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work

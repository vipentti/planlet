# Tasks: Release-cut maintainer utility

- [ ] T1 Add `scripts/release.mjs` with `prepare` and `tag` subcommands; shared
      argv (`--version`, `--release-date`, `--execute`, `--help`); `tag`-only
      `--push`; strict/duplicate-flag rejection; dry-run default; clear stderr
      errors naming the failed operation; no worktree, local-ref, or remote-write
      mutations without `--execute`
- [ ] T2 Extend `assert-changelog-release-ready.mjs` with mutually exclusive
      `--verify-release-date YYYY-MM-DD` historical mode (empty Unreleased,
      matching version section, valid date, non-empty notes, exact date match;
      no not-in-the-past). Preserve `--release-date` prepare-time semantics
      including past-date rejection. Add helper tests for past reject, earlier-day
      verify accept, and verify mismatch reject
- [ ] T3 Implement shared remote-read helpers and dry-run purity: `git ls-remote`
      for remote `main` and exact tag/branch refs; mutation classes; dry-run never
      `git fetch` or falsely claims identity when unproven; `--execute` fetches
      explicitly before mutating
- [ ] T4 Implement `prepare` mode selection then fresh path: discover
      local/remote branch and PR first; fresh-only clean-tree + `HEAD ==` remote
      main tip; changelog cut; package/lock alignment; assert `--release-date`;
      `changelog.mjs` smoke; create `release/v<version>` signed commit
- [ ] T5 Implement `prepare` resume path: validate existing release commit against
      invariants (single parent/base, message, signature, release-files-only diff,
      versions, changelog via verify mode as needed, local/remote SHA agreement);
      resume push and/or PR only; refuse divergent/ambiguous states; never
      recreate/predict SHAs; never delete/force-update; matching PR idempotent
- [ ] T6 Implement `tag`: require `HEAD ==` current remote main tip; derive date
      from changelog; assert `--verify-release-date`; exact remote tag collision
      via `ls-remote` before local tag; `git tag -a -s`; optional `--push`; refuse
      stale ancestors when main advanced, force/delete/unsigned/publish
- [ ] T7 Add `release:prepare` and `release:tag` scripts to `package.json`; update
      `RELEASING.md` for fresh/resume prepare, `--verify-release-date` tag path,
      main-tip tagging, and dry-run remote-read semantics
- [ ] T8 Add fixture/subprocess tests (temp repos, bare remotes, stubbed `gh` /
      signing): dry-run purity; fresh prepare; resume after commit-without-push and
      push-without-PR; divergent branch refused; matching PR idempotence;
      remote-only tag collision; stale main-tip refused; tag on later UTC day than
      prepare
- [ ] T9 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work

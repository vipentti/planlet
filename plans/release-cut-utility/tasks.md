# Tasks: Release-cut maintainer utility

- [ ] T1 Add `scripts/release.mjs` with `prepare` and `tag` subcommands; shared
      argv (`--version`, `--release-date`, `--execute`, `--help`); `tag`-only
      `--push`; strict/duplicate-flag rejection; dry-run default; clear stderr
      errors naming the failed operation; no worktree, local-ref, or remote-write
      mutations without `--execute`
- [ ] T2 Extend `assert-changelog-release-ready.mjs` with exact contract:
      `--verify-release`, optional `--verify-release-date YYYY-MM-DD`, optional
      `--print-release-date` (stdout exactly `YYYY-MM-DD\n`); mutual exclusion vs
      `--release-date`; usage errors for illegal combos/duplicates; preserve CI and
      strict `--release-date`. Helper tests for derive/print, match, mismatch,
      malformed/duplicate sections, exact stdout, illegal flag combos, unchanged
      CI/prep past rejection
- [ ] T3 Implement remote-ref probe using `git ls-remote --exit-code`: exit `0` +
      exact ref (tag peel-pair OK) → found; exit `2` + no match → absent; else
      failed; no stderr inference; prefix nonmatch ≠ found; remote main absent
      fail-closed. Tests: found, absent, inaccessible remote, malformed URL, peel
      pair, prefixed nonmatch
- [ ] T4 Implement signature helpers and post-creation gate: `git verify-commit` /
      `git verify-tag` exit `0` only; GPG/SSH via Git; no allowlist; missing verify
      config fails closed; preliminary signing prechecks are diagnostics only;
      mandatory verify of the exact new object before any push. Fixture/stub:
      valid, invalid, unsigned/lightweight, tooling missing
- [ ] T5 Implement `prepare` mode selection then fresh path: discover
      local/remote branch and open/closed/merged PRs first; fresh clean-tree +
      `HEAD ==` remote main tip; changelog cut; package/lock alignment; assert
      `--release-date`; notes smoke; `git commit -S`; resolve SHA; full
      release-commit invariants including `verify-commit`; only then push/PR; on
      verify failure leave local commit, no push/PR, clear not-pushed error
- [ ] T6 Implement `prepare` resume: commit invariants including verify-commit;
      helper `--verify-release --print-release-date` for changelog; PR-state
      handling (open/merged/closed-unmerged/conflicting); resume after local
      post-creation-verify failure; never recreate SHAs; never delete/force-update
- [ ] T7 Implement `tag` fresh/resume: `HEAD ==` remote main tip; helper
      `--verify-release --print-release-date` (+ `--verify-release-date` when
      operator passes `--release-date`); fresh `git tag -a -s` then full local-tag
      invariants including `verify-tag` then optional `--push` (create → verify →
      push only); on verify failure leave local tag, no push, clear error; resume
      validates or refuses existing local tag; remote tag found = hard refuse;
      never recreate/force-update
- [ ] T8 Add `release:prepare` and `release:tag` to `package.json`; update
      `RELEASING.md` with exact assert flags, crypto-validity-only signing,
      post-creation verify-before-push, ls-remote exit classification,
      fresh/resume flows, and PR states
- [ ] T9 Add fixture/subprocess tests covering T2–T7 (temp repos, bare remotes,
      stubbed `gh`/verify): dry-run purity; prepare/tag resume; PR states; tag
      push-fail retry; ls-remote matrix; later-UTC-day tag; fresh commit/tag
      verify-success→push; verify-fail→no remote mutation + local object retained;
      rerun resume after failed post-creation verify; `--execute --push` ordering;
      no cleanup/force after verify failure
- [ ] T10 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work

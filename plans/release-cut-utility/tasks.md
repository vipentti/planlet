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
- [ ] T5 Implement shared SHA-anchored release-commit validator: resolve one
      candidate SHA; `git show` blob-extract `CHANGELOG.md` / `package.json` /
      `package-lock.json` to OS temp dir; helper on extracted paths (argv array);
      version equality; `verify-commit`; diff-tree vs parent; finally cleanup;
      never validate ambient worktree; never execute candidate scripts. Use for
      both fresh post-creation and resume
- [ ] T6 Implement `prepare` mode selection then fresh path: discover
      local/remote branch and open/closed/merged PRs first; fresh clean-tree +
      `HEAD ==` remote main tip; changelog cut; package/lock alignment; assert
      `--release-date`; notes smoke; `git commit -S`; shared validator on new SHA;
      only then push/PR; on verify failure leave local commit, no push/PR, clear
      not-pushed error
- [ ] T7 Implement `prepare` resume: candidate selection (local/remote/PR SHA
      agreement); shared validator; remote-only dry-run no-fetch/no-false-success;
      execute controlled fetch without force/checkout; PR-state handling; resume
      after local post-creation-verify failure; never recreate SHAs; never
      delete/force-update
- [ ] T8 Implement `tag` fresh/resume: `HEAD ==` remote main tip; helper
      `--verify-release --print-release-date` (+ `--verify-release-date` when
      operator passes `--release-date`); fresh `git tag -a -s` then full local-tag
      invariants including `verify-tag` then optional `--push` (create → verify →
      push only); on verify failure leave local tag, no push, clear error; resume
      validates or refuses existing local tag; remote tag found = hard refuse;
      never recreate/force-update
- [ ] T9 Add `release:prepare` and `release:tag` to `package.json`; update
      `RELEASING.md` with exact assert flags, crypto-validity-only signing,
      post-creation verify-before-push, SHA-anchored candidate validation,
      remote-only resume limits, ls-remote exit classification, fresh/resume
      flows, and PR states
- [ ] T10 Add fixture/subprocess tests covering T2–T8 (temp repos, bare remotes,
      stubbed `gh`/verify): dry-run purity; prepare/tag resume; PR states; tag
      push-fail retry; ls-remote matrix; later-UTC-day tag; post-creation
      verify-success→push and verify-fail→retain; resume on `main` with branch
      elsewhere; worktree≠candidate; candidate-valid/checkout-invalid;
      checkout-valid/candidate-invalid; remote-only fetch+validate; dry-run
      remote-only unavailable; missing/malformed candidate paths; shared
      validator; helper gets extracted paths; temp cleanup; no candidate script
      execution; `--execute --push` ordering
- [ ] T11 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work

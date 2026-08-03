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
      candidate SHA; blob-extract release files to OS temp dir; enforce
      `package.json.version`, `package-lock.json.version`, and
      `packages[""].version` all equal `--version` with `packages[""]` an object;
      helper on extracted paths; `verify-commit`; diff-tree vs parent; finally
      cleanup; never ambient worktree; never candidate scripts. Shared by fresh
      and resume
- [ ] T6 Implement `prepare` fresh path: mode selection; clean-tree + `HEAD ==`
      remote main tip; changelog cut; update all three package/lock root versions
      (npm-supported or minimal JSON edits; no dependency rewrites); assert
      `--release-date`; `git commit -S`; shared validator; push exact SHA → exact
      ref; re-probe then PR; on verify failure leave local commit
- [ ] T7 Implement `prepare` resume with pinned remote flow: record
      `observedRemoteReleaseSha`; PR classify vs that SHA; dry-run no-fetch; temp
      namespaced fetch-ref (no overwrite); fetched SHA must equal observed;
      re-probe before PR; local-only SHA→ref push fail-closed on concurrent
      remote; no synchronize-push; finally cleanup only owned temp refs; shared
      validator; PR-state handling; never force-update
- [ ] T8 Implement `tag` fresh/resume: `HEAD ==` remote main tip; helper
      `--verify-release --print-release-date` (+ `--verify-release-date` when
      operator passes `--release-date`); fresh `git tag -a -s` then verify-tag then
      optional `--push`; leave local tag on verify failure; resume
      validates/refuses; remote tag found = hard refuse
- [ ] T9 Add `release:prepare` and `release:tag` to `package.json`; update
      `RELEASING.md` for assert flags, signing, post-creation verify, SHA-anchored
      validation, lockfile root version contract, pinned remote probe/fetch/
      re-probe, temp fetch-ref cleanup, fresh/resume, and PR states
- [ ] T10 Add fixture/subprocess tests covering T2–T8: prior cases plus lockfile
      three-field align/stale/missing/malformed; fresh updates all three; resume
      refuses inconsistent lockfile; remote SHA stable vs moved between probe and
      fetch; fetched≠observed; post-validate remote move/disappear; exact SHA→ref
      push; concurrent branch appearance; temp-ref cleanup including same-name
      collision and failure path
- [ ] T11 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work

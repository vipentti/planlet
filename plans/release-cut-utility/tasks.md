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
- [ ] T6 Implement `prepare` fresh path: three-way mode selection requiring local
      branch, remote branch, and every relevant open/closed-unmerged/merged PR to
      be absent before fresh; clean-tree + `HEAD ==`
      remote main tip; changelog cut; update all three package/lock root versions
      (npm-supported or minimal JSON edits; no dependency rewrites); assert
      `--release-date`; `git commit -S`; shared validator; atomic
      expected-absence push of exact SHA → exact ref; re-probe then PR; on verify
      failure leave local commit
- [ ] T7 Implement `prepare` resume with pinned remote flow: record
      `observedRemoteReleaseSha`; PR classify vs that SHA; dry-run no-fetch; temp
      namespaced fetch-ref (no overwrite); fetched SHA must equal observed;
      re-probe before PR; local-only SHA→ref push fail-closed on concurrent
      remote; no synchronize-push; finally cleanup only owned temp refs; shared
      validator; PR-state handling; never force-update. Branch-backed resume
      behavior is unchanged by T13
- [ ] T8 Implement `tag` fresh/resume: `HEAD ==` remote main tip; helper
      `--verify-release --print-release-date` (+ `--verify-release-date` when
      operator passes `--release-date`); fresh `git tag -a -s` then verify-tag then
      optional `--push` via the T12 atomic expected-absence creation of
      `refs/tags/v<version>` (remote tag at the same object = lost race, reported
      as pre-existing remote state, never as this invocation's push); leave local
      tag on verify failure; resume
      validates/refuses; remote tag found = hard refuse; never move, replace, or
      force-update a tag
- [ ] T9 Add `release:prepare` and `release:tag` to `package.json`; update
      `RELEASING.md` for assert flags, signing, post-creation verify, SHA-anchored
      validation, lockfile root version contract, pinned remote probe/fetch/
      re-probe, temp fetch-ref cleanup, fresh/resume, PR states, and atomic
      expected-absence ref creation including lost-race recovery/collision notes
      and that the lease never authorizes overwriting an existing ref; document
      PR-only release history after head-branch deletion (merged = already
      complete; closed-unmerged/open/conflicting = investigate) and that a
      deleted branch never makes a merged or closed release fresh again
- [ ] T10 Add fixture/subprocess tests covering T2–T8, T12, and T13: prior cases plus lockfile
      three-field align/stale/missing/malformed; fresh updates all three; resume
      refuses inconsistent lockfile; remote SHA stable vs moved between probe and
      fetch; fetched≠observed; post-validate remote move/disappear; exact SHA→ref
      push; concurrent branch appearance; temp-ref cleanup including same-name
      collision and failure path. Deterministic bare-local-remote concurrency
      tests: branch created when remote stays absent; concurrent branch at a
      different SHA rejected; concurrent branch at the identical SHA rejected as a
      lost creation race; concurrently created ancestor branch not fast-forwarded;
      no plain force push issued; lease failure reclassifies or fails closed; tag
      created when remote tag absent; concurrent tag at a different object
      rejected; concurrent tag at the same object rejected as pre-existing remote
      state; no tag moved/replaced/force-updated; unsupported lease semantics do
      not fall back to ordinary push; assert ordering probe absent → local
      validation → atomic push → classification. Stubbed-`gh` PR-only tests:
      merged PR with remote branch deleted and no local branch reports already
      complete; merged PR-only state recreates and pushes nothing; merged
      PR-only state works when the historical head commit is unavailable
      locally; closed-unmerged PR with deleted branch hard-refuses; open PR with
      missing branch hard-refuses; no branch + merged PR never enters fresh
      preparation; no branch + closed PR never creates a replacement PR;
      multiple relevant PR-only records hard-refuse; PR head/base/version
      mismatch hard-refuses; branch-backed resume still requires PR head SHA
      equality and candidate validation; stale PR lookup changing during
      classification restarts or fails closed; no `git push`, lease push, or
      `gh pr create` in PR-only completed or refusal states
- [ ] T11 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work
- [ ] T12 Implement atomic expected-absence remote-ref creation shared by the
      branch and tag pushes (precedes T6, T7, T8):
      `git push --porcelain --force-with-lease=<exact-ref>: origin <src>:<exact-ref>`
      with success requiring exit `0` **and** porcelain status `*`; treat `=`
      (up to date) as a lost creation race; no fast-forward of a concurrently
      created ancestor; no plain `--force`, no relaxed-lease retry, no
      remote-tracking-derived lease; lease failure triggers rediscovery and
      reclassification or a clear fail-closed result without claiming this
      invocation created the ref; unsupported or unparseable lease capability
      fails closed with diagnostics naming unguaranteed atomic creation, never an
      ordinary-push fallback
- [ ] T13 Implement PR-only release-history classification for a deleted head
      branch (precedes T6 fresh-mode entry): classify the complete open/closed/
      merged `gh` lookup for exact head `release/v<version>` and base `main`
      before requiring a branch-backed candidate; exactly one matching merged PR
      with a concrete head SHA and no conflicting records reports already
      complete with URL and head SHA, without recreating the branch, pushing, or
      creating a PR, without requiring the historical object locally, and without
      claiming revalidation that did not run; closed-unmerged, open-without-
      branch, and conflicting/multiple/unusable-metadata states hard-refuse with
      investigation guidance; never choose the newest PR heuristically; re-query
      when the lookup may be stale and restart discovery once or fail closed on
      change, never creating a branch in the stale pass

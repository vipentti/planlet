# Tasks: Release-cut maintainer utility

- [ ] T1 Add `scripts/release.mjs` with `prepare` and `tag` subcommands; shared
      argv (`--version`, `--release-date`, `--execute`, `--help`); `tag`-only
      `--push`; strict/duplicate-flag rejection; dry-run default; clear stderr
      errors naming the failed operation; no worktree, local-ref, or remote-write
      mutations without `--execute`
- [ ] T2 Extend `assert-changelog-release-ready.mjs` as sole changelog parser:
      historical verify (no not-in-the-past); optional explicit date or derive;
      stable machine-readable resolved-date output (e.g. `--print-release-date`
      or small JSON); mutually exclusive with prep `--release-date`; preserve CI
      and prep modes. Helper tests: derive/print, match, mismatch,
      malformed/duplicate sections, stable output, unchanged CI/prep including
      past-date rejection
- [ ] T3 Implement remote-ref probe helper classifying found / absent / failed
      for main, release branch, and tags; dry-run purity (`ls-remote` only, no
      fetch); `--execute` fetches explicitly; tests for absent vs broken remote
- [ ] T4 Implement `prepare` mode selection then fresh path: discover
      local/remote branch and open/closed/merged PRs first; fresh-only clean-tree
      + `HEAD ==` remote main tip; changelog cut; package/lock alignment; assert
      `--release-date`; notes smoke; create `release/v<version>` signed commit
- [ ] T5 Implement `prepare` resume: commit invariants; push resume; PR-state
      handling (open matching report, merged matching already-complete, closed
      unmerged refuse, conflicting/ambiguous refuse, create only when no relevant
      PR); never recreate SHAs; never delete/force-update
- [ ] T6 Implement `tag` fresh/resume: `HEAD ==` remote main tip; invoke helper
      historical verify and consume machine-readable date (no changelog parse in
      `release.mjs`); fresh create annotated signed tag; resume validate local-only
      tag then idempotent report or `--push`; remote tag found = hard refuse;
      never recreate/force-update tags
- [ ] T7 Add `release:prepare` and `release:tag` scripts to `package.json`; update
      `RELEASING.md` for fresh/resume prepare and tag, helper-owned dates, PR
      states, ls-remote found/absent/failed, and local-tag-then-push workflow
- [ ] T8 Add fixture/subprocess tests (temp repos, bare remotes, stubbed `gh` /
      signing): dry-run purity; fresh prepare; resume push/PR; PR open/merged/
      closed-unmerged/conflicting; tag push-fail then retry; local-only tag
      idempotent; local+push once; invalid local tag refuse; remote tag refuse; no
      force/recreate; ls-remote absent vs failed; stale main tip; later-UTC-day tag
- [ ] T9 Run format/lint/type-check/build/test and `git diff --check`; fix
      regressions in release helpers touched by this work

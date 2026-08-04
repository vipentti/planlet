# Tasks: Release-cut maintainer utility

- [x] T1 Add `scripts/release.mjs` with `prepare` and `tag` subcommands: required
      `--version`, optional `--release-date`, `--execute`, `--help`, `tag`-only
      `--push`; dry-run default; reject unknown flags, duplicate value flags, and
      a missing or malformed subcommand; subprocess failures name the operation
      and surface stderr without echoing credentials
- [x] T2 Extend `assert-changelog-release-ready.mjs` with historical mode:
      `--verify-release`, optional `--date YYYY-MM-DD`, optional `--print-date`
      (stdout exactly `YYYY-MM-DD\n`); verification-only options require
      `--verify-release`; preparation and historical modes cannot combine;
      historical mode has no not-in-the-past rule; `--print-date` writes exactly
      `YYYY-MM-DD\n` to stdout and nothing else, diagnostics to stderr; preserve
      ordinary CI behavior and strict `--release-date`. Focused helper
      tests for validate, expected-date match and mismatch, exact printed date,
      past historical date accepted, illegal combos, and unchanged CI/past-date
      rejection
- [x] T3 Implement fresh `prepare`: refuse on local or remote `release/v<version>`,
      matching open/merged/closed-unmerged PR, multiple or conflicting PR matches,
      version already current, changelog already containing the release, or
      existing remote tag; require clean worktree and `HEAD ==` remote `main` tip;
      cut the changelog; update `package.json.version`, `package-lock.json.version`,
      and `package-lock.json.packages[""].version`; run one small
      `validateReleaseContents()` (three root version fields, `packages[""]` an
      object, changelog helper) on the edited worktree; `git commit -S`;
      post-commit checks on the exact new SHA (message, one parent,
      `git verify-commit`, changed paths limited to the release files); then
      repository-state checks (`HEAD` equals the new SHA, no staged changes, no
      unstaged changes, no unexpected untracked hook-created state) and a second
      `validateReleaseContents()` run on the committed checkout, so a commit hook
      cannot alter an allowed release file undetected; probe the remote ref then
      ordinary explicit non-force push;
      verify the remote ref; `gh pr create` only after a successful push; on any
      post-commit failure leave the branch, commit, index, and worktree untouched
      (never reset, amend, clean, restore, or rerun the commit) and report that
      the signed commit was created but post-commit validation failed, with
      manual recovery guidance
- [x] T4 Implement `tag`: clean worktree, `HEAD ==` remote `main` tip, package
      version match; resolve the release date only through historical helper mode
      — `--verify-release --print-date`, plus `--date D` when the operator passes
      `tag --release-date D`, never the helper's strict `--release-date` — and
      accept stdout only as exactly one `YYYY-MM-DD` line with a single trailing
      newline and nothing else, refusing on malformed output or nonzero exit and
      surfacing the helper diagnostic; report the resolved date in dry-run and
      success output; refuse when the remote tag
      exists; fresh `git tag -a -s` then `git verify-tag`; existing-local-tag
      validation (annotated, exact name and message, target `HEAD`, valid
      signature) for the two-step workflow, which still requires the shared
      preconditions and date contract to pass on the current `HEAD` before push;
      ordinary explicit non-force push only
      with `--push`; verify the remote tag afterwards; never move, recreate,
      replace, delete, or force-update a tag; leave the local tag on verification
      failure
- [x] T5 Add `release:prepare` and `release:tag` npm aliases; update `RELEASING.md`
      with the scripted happy path, manual recovery guidance, and an explicit
      statement that there is no automatic prepare resume
- [x] T6 Add focused fixture/subprocess tests (temp repos, bare local remotes,
      stubbed `gh` and signing) covering the cases listed under Tests in
      `plan.md`, including fixture commit hooks that mutate a release file, leave
      staged or unstaged changes, or create untracked state after `git commit`,
      each refusing before any push or PR, and the tag release-date cases
      (derived vs expected date, mismatch refusal, past date accepted, strict
      `--release-date` never invoked, malformed/extra/nonzero helper output
      refused, same contract on both tag push paths, dry-run reporting the
      resolved date); run `npm run format:check`, `npm run lint`, `npm run type-check`,
      `npm run build`, `npm test`, and `git diff --check`

## Completion

- Completed at: 2026-08-04T03:20:23.249Z
- Mode: normal

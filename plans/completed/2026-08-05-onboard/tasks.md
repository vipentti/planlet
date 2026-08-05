# Tasks: Agent Onboarding

- [x] T1 Add CLI-owned snippet source and `planlet onboard`

  Create `src/core/agent-snippet.ts` with `renderAgentSnippet()` (exact snippet
  above, no trailing newline in the constant; newline added at print time).
  Register `onboard` in `COMMAND_HELP` and `prepareCommand`; add `handleOnboard`
  in `src/commands/handlers.ts` printing raw snippet + newline without TOON
  wrap. Command works outside a repository (extend repository-discovery
  allowance or short-circuit before discovery). Read-only: no plans/, skill,
  or AGENTS.md writes.

  Acceptance: in-process CLI test asserts stdout equals snippet + newline and
  exit code 0; `help onboard` shows usage; running in a non-repo temp dir
  succeeds and leaves no files.

- [x] T2 Wire agents-file writing into `planlet init` and `planlet update`

  Add `renderAgentsSection()` and `updateAgentFiles()` to the snippet module:
  markers `<!-- BEGIN PLANLET AGENTS v:1 hash:<8-hex> -->` /
  `<!-- END PLANLET AGENTS -->`, SHA-256 body hash, replace-by-marker, append
  when absent, no-op when hash fresh, leave-alone + warning on malformed own
  markers, foreign markers untouched, unrelated content byte-preserved.

  Init behavior: write `AGENTS.md` by default; also write `CLAUDE.md` only when
  it is a real regular file (lstat, never symlink/non-regular) that does not
  already import `AGENTS.md` via `@AGENTS.md` include; skip silently when
  absent or covered. `--no-agents` skips both files.

  Update behavior: refresh present planlet markers in `AGENTS.md` and
  `CLAUDE.md`; never create sections in non-opted-in repos; never touch
  foreign content.

  Wire `--no-agents` into init parsing and `HarnessCommandArguments`; call
  `updateAgentFiles` from `installHarnessSkills` under the existing
  per-repository lock (also when `--tools none`); extend installation summary
  with per-file agents state; `git add` each written file (explicit paths)
  when `.git` exists, warning on failure; non-regular files skipped with
  warning; `update` rejects `--no-agents`.

  Acceptance: unit tests cover render/hash determinism, replace, append,
  idempotence, opt-out, foreign-marker safety, malformed-marker leave-alone,
  CLAUDE.md symlink/import rules, update refresh-only. Integration tests with
  temp git repo assert file content, preserved unrelated content, staged
  files, `--tools none` still writes unless `--no-agents`, and update creates
  nothing in non-opted-in repos.

- [x] T3 Add README onboarding section, Commands row, and drift test

  Add README section between "The skill-first flow" and "Driving the CLI
  directly" quoting the snippet exactly once in a fenced block, plus
  `onboard` row in the Commands table. Add unit test reading README and
  asserting fenced block equals `renderAgentSnippet()` and table contains the
  `onboard` row.

  Acceptance: test passes with matching content; test fails (demonstrated
  locally during implementation) when README quote or source constant drifts
  independently.

- [x] T4 Add CHANGELOG entry and run full suite gate

  Add `[Unreleased]` entry under `### Added` covering `planlet onboard`,
  `planlet init` AGENTS.md/CLAUDE.md sections with `--no-agents` opt-out, and
  `planlet update` refresh of present markers. Run full verification suite;
  confirm clean diff (only intended files), no leaked tool-output markup in
  planlet files.

  Acceptance: CHANGELOG entry present under `[Unreleased]`; full suite green:
  format:check, lint, knip, type-check, build, test, git diff --check,
  git status --porcelain empty.

## Completion

- Completed at: 2026-08-05T15:33:01.808Z
- Mode: normal

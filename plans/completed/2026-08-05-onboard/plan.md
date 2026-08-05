# Agent Onboarding

## Summary

Add an agent-onboarding surface. `planlet onboard` prints a ~10-line AGENTS.md
pointer snippet; `planlet init` writes the same snippet into `AGENTS.md` by
default inside a planlet-owned marker fence, and into `CLAUDE.md` when that
file is a real regular file that does not already import `AGENTS.md`;
`planlet update` refreshes present planlet markers only. A drift test keeps the
README's single quoted copy in sync with the CLI-owned snippet source.

Closes the high-severity gap where `--tools agents` installs skills into
`.agents/skills` but harnesses that only read `AGENTS.md` (or `CLAUDE.md`)
never discover Planlet.

## Scope

In:

- `planlet onboard`: prints the snippet to stdout, no repository mutation,
  registered in `COMMAND_HELP` + command table in `src/cli.ts`, listed in
  README Commands table.
- README section quoting the snippet once (between "The skill-first flow" and
  "Driving the CLI directly"), plus Commands-table row.
- `planlet init --no-agents` opt-out. Init writes the fenced section to
  `AGENTS.md` by default; also writes it to `CLAUDE.md` only when `CLAUDE.md`
  is a real regular file (never through a symlink or other non-regular path)
  that does not already import `AGENTS.md` via an `@AGENTS.md` include; skip
  silently when absent or covered by the import.
- `planlet update` refreshes present planlet markers in `AGENTS.md` and
  `CLAUDE.md` (hash fresh -> no-op no-write); update never creates sections in
  non-opted-in repositories and never touches foreign content.
- Marker contract: `<!-- BEGIN PLANLET AGENTS v:1 hash:<8-hex> -->` /
  `<!-- END PLANLET AGENTS -->`, replace-by-marker on re-run, append when
  absent, preserve unrelated content, never touch foreign markers.
- `git add` for each planlet-written file (explicit paths only) after a write
  in git repositories.
- Tests: onboard output, marker replace/append/idempotence, opt-out,
  foreign-marker safety, CLAUDE.md symlink/import rules, update refresh-only
  rule, README quote drift.
- CHANGELOG `[Unreleased]` entry.

Out:

- Snippet text changes to skills or `planlet_design.md`; the snippet stays a
  pointer, not a restatement of enforcement rules (portable-enforcement lane
  collision mitigation).
- Instruction files other than `AGENTS.md` and `CLAUDE.md`.
- `planlet init` prompting about AGENTS.md/CLAUDE.md; the write is
  unconditional by default and `--no-agents` is the non-interactive
  equivalent.

## Approach

### One CLI-owned snippet source

New module `src/core/agent-snippet.ts`:

- `renderAgentSnippet(): string` — the exact snippet body (approved report
  section 5 R1 draft, wording adjusted only to match the actual CLI surface),
  no trailing newline in the constant; newline added at print time.
- `renderAgentsSection(): string` — snippet wrapped in
  `<!-- BEGIN PLANLET AGENTS v:1 hash:<8-hex> -->` / `<!-- END PLANLET AGENTS -->`,
  hash = first 8 hex chars of SHA-256 of the body (reuse `sha256` from
  `src/core/skill-source.ts`; matches beads `computeHash`).
- `updateAgentFiles(root, { operation, skip })`: per-file outcome for the two
  target files. Init: `AGENTS.md` create/replace/append unless `skip`;
  `CLAUDE.md` only when it is a regular file (lstat, not symlink) without an
  `@AGENTS.md` include. Update: replace only when the planlet BEGIN marker is
  already present; absent marker or absent file -> no-op, never create. Hash
  fresh -> no-op no-write. Own BEGIN marker without valid END, or END before
  BEGIN -> leave file unchanged and report `left-alone` warning. Foreign
  marker patterns are unrelated text, preserved by append.

Both `onboard` and `init`/`update` render from this one module; no second copy
of the snippet exists anywhere in `src/`.

### `planlet onboard`

- `COMMAND_HELP.onboard`: `Usage: planlet onboard`.
- New handler `handleOnboard` prints `renderAgentSnippet()` + trailing newline
  raw to stdout (no TOON wrap — output is meant to be pasted), returns
  `EXIT_CODES.success`.
- Read-only, repository-independent: prints from any directory. Implementation
  either adds `onboard` to `allowUnmarkedStart` in `main`'s repository
  discovery or runs the handler before discovery; pick whichever keeps
  `--root`/global parsing consistent.

### `planlet init` / `planlet update` integration

- New boolean flag `--no-agents` parsed in `src/cli.ts` init branch and passed
  through `HarnessCommandArguments` to `installHarnessSkills`. `update` does
  not accept `--no-agents` (parse error).
- `installHarnessSkills` calls `updateAgentFiles` after harness install.
  Runs inside the existing per-repository install lock; when no destinations
  are selected (`--tools none`), the same lock guards the agents-file write so
  `AGENTS.md` is still written by default on init.
- Installation summary gains an `agentFiles` record (`relative path` ->
  `added | updated | unchanged | skipped | left-alone`) rendered by the
  existing TOON path; existing init-output assertions updated.
- After a write in a directory with a `.git` marker, run
  `git add <file>` per written file (explicit paths only, never `-A`);
  failure becomes a warning, never a failed init/update. No git call in
  non-git directories (`init` currently supports unmarked roots).
- Only regular files are ever written or replaced. If `AGENTS.md` or
  `CLAUDE.md` is a symlink or other non-regular path, it is skipped with a
  warning, never followed or overwritten.

### README drift protection

Unit test reads `README.md`, extracts the fenced block under the new onboarding
heading, and asserts it equals `renderAgentSnippet()`. Test also asserts the
Commands table contains the `onboard` row. This fails on either side drifting
alone. The existing `update --tools all` + `git diff --exit-code` CI step does
not cover README, so this is a dedicated test, not a workflow change.

### Snippet text (verbatim)

```markdown
## Planning with Planlet

This repository uses Planlet for focused implementation plans. A planlet is
`plans/<slug>/plan.md` + `tasks.md`; Markdown is the source of truth.

- Propose a planlet before multi-step work; skip it for one-file changes.
- Drive it with the `planlet` CLI, never by hand-editing plan files:
  `planlet create|show|tasks|status|validate <slug>`,
  `planlet task check <slug> <task-id>`, `planlet complete <slug>`.
- Check each task off only after its verification passes. When the last task is
  checked, run `planlet complete <slug>` to archive it.
- Run `planlet help [command]` before using a command you have not used here.
- If no `planlet` executable is available, stop and say so. Do not hand-create
  or hand-edit planlet files.
```

Carries the #37 CLI-first stop-line, so a snippet-only agent never hand-edits
planlet files.

## Acceptance Criteria

- `planlet onboard` prints exactly the snippet above (plus final newline);
  `planlet help onboard` shows its usage; runs read-only from any directory.
- `planlet init` (no flags) writes or updates the fenced `AGENTS.md` section;
  re-run with current content writes nothing; re-run with a stale hash replaces
  only the section; `--no-agents` leaves both files untouched.
- Init writes the section to a regular `CLAUDE.md` without an `@AGENTS.md`
  import; skips silently when `CLAUDE.md` is absent, a symlink/non-regular
  file, or already imports `AGENTS.md`.
- `planlet update` refreshes present planlet markers in `AGENTS.md` and
  `CLAUDE.md`; never creates sections where no marker exists; never touches
  foreign content.
- Existing file content outside the marker fence is byte-preserved; foreign
  markers are left alone.
- `git add` runs for each written file in a git repo; no git call or warning
  in a non-git dir.
- README quote and Commands-table row match CLI-owned source; drift test fails
  if either changes alone.
- No new dependencies; full suite green.

## Verification

Strategy only: run `npm run format:check`, `npm run lint`, `npm run knip`,
`npm run type-check`, `npm run build`, `npm test`, `git diff --check`, then
`git status --porcelain` expecting empty (build output gitignored). CI runs the
same suite plus the skill-regeneration drift step. New targeted tests carry
the behavioral proof (onboard output, marker replace/append/idempotence,
opt-out, CLAUDE.md symlink/import rules, update refresh-only, foreign-marker
safety, README drift). No `## Verification Evidence` note is expected: all
results are ordinary, reproducible test/CI history.

## Risks and Considerations

- `AGENTS.md` and `CLAUDE.md` are user-owned: the marker contract (own BEGIN +
  valid END only, append otherwise, hash freshness) is the clobber protection;
  malformed own markers degrade to leave-alone + warning, never partial
  rewrite.
- Symlinked `AGENTS.md`/`CLAUDE.md` are never followed; skipping with a
  warning keeps writes inside the repository.
- `git add` is a new init/update mutation; explicit-path only, warning on
  failure.
- README is published npm surface; drift test is the guard.
- `CLAUDE.md` import check prevents duplicate markers and drift between the
  two copies when a project already imports `AGENTS.md`.
- Interactive init prompt unchanged; the AGENTS.md/CLAUDE.md write is
  unconditional by default and needs no new prompt.

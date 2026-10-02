# Configurable Plans Directory

## Summary

Planlet honors an optional committed `.planlet.json` at the discovered
repository root with a `plansDir` key. Absent file keeps today's `plans/`
layout. Present file selects another repository-relative directory. Every
reader, writer, `init`, archive move, link-rewrite prefix, and
`check-completion` uses that one resolved value. Planlet's own repository
stays on `plans/` and does not add `.planlet.json`.

## Scope

Changes:

- Resolver and JSON parser for `.planlet.json`, plus leftover-`plans/`
  conflict detection.
- Wiring of read-only commands, `create`, task updates, `complete`, link
  rewrite prefixes, `init`, archive paths, and both completion-gate
  functions (`pathspec` and slug extraction).
- `planlet init --plans-dir <relative>`: write `.planlet.json` only when the
  value is not `plans`.
- Agent snippet default-plus-file wording (no baked resolved path). `plansDir`
  on `list` and the no-command dashboard. Slug-creation error names
  `<plansDir>/completed/`.
- Docs: `planlet_design.md` §9 and §9.1, README layout and CI, CHANGELOG
  `[Unreleased]`. Regenerated agent section only if snippet bytes change.
- Tests listed under Verification.

Excluded:

- YAML parsing. `.planlet.yaml` and `.planlet.yml` are reserved and rejected
  loudly until a later change adds a parser.
- `.planletrc.json` and `.planlet.config.json` as accepted names (rejected
  loudly if present).
- A `planlet move` command. Migration is a documented `git mv` plus manual
  link fix.
- Environment variables, per-command `--plans-dir` on later commands,
  `package.json` keys, parent-directory config search, autodiscovery of
  multiple plan trees.
- Guarding a previous custom directory other than leftover `plans/`.
- Adding `.planlet.json` to this repository.
- New runtime dependencies.

## Approach

**File.** Canonical name is exactly `.planlet.json` (hidden, lowercase) at
the discovered root. Commit it; do not gitignore it. JSON only via
`JSON.parse`. Two-space indent and a trailing newline when `init` writes it.
Unknown keys are ignored. Omitting `plansDir` yields default `plans/`. A
present `plansDir` must be a string that passes the path rules below.

**Discovery.** Read config only from the already-discovered repository root
(`--root`, else nearest `.git`, else unmarked start for `create`/`init`). No
parent walk for the file. A readable `.planlet.json` (or a reserved
config-shaped name that this change rejects) at the start directory counts as
an unmarked-root marker the same way `plans/` does. `onboard` stays
discovery-free and prints the default-path rule from the same snippet
renderer as `init`/`update`.

**`plansDir` syntax.** Relative posix path: no leading or trailing slash, no
empty / `.` / `..` segments, no backslash, no whitespace, no git pathspec
globs (`*`, `?`, `[`). Each segment matches `[A-Za-z0-9._-]`. Resolve with
`resolveSafePath` so a symlink cannot leave the root. A non-directory
existing path stays `write_conflict`.

**Reserved names.** If `.planlet.yaml`, `.planlet.yml`, `.planletrc.json`, or
`.planlet.config.json` exists at the root, fail with `invalid_config` naming
every such file. Two or more config-shaped files (including `.planlet.json`
plus a reserved name) is the same error listing all of them. A non-hidden
`planlet.json` is not read and is not an error.

**Errors.** Malformed or non-regular `.planlet.json`, invalid `plansDir`,
wrong JSON types, and reserved names are `invalid_config` (operational exit).
Never fall back to `plans/` for a broken file. Leftover default tree is
`plans_dir_conflict` (also operational), distinct from `plans_not_initialized`.
The gate swallows only `plans_not_initialized`. Do not swallow
`plans_dir_conflict` or `invalid_config`.

**Leftover `plans/`.** When resolved `plansDir` is not `plans` and
`<root>/plans` is a directory that still contains a child directory (a
planlet or `completed/`), fail reads, writes, and the gate with
`plans_dir_conflict`. Absent `plans/` or a non-directory at that name leaves
the guard idle. A second custom-to-custom move is not detected.

**Missing configured directory.** Same as missing `plans/` today: readers
throw `plans_not_initialized`; the gate turns that into `ok: true`; `create`
and `init` create it. Do not fall back to `plans/`.

**Resolver.** One core function after `--root` discovery. Call sites pass
`plansDir` segments into `resolveSafePath`. Link rewrite keeps one `../`
because `completed/` stays a child of the plans directory.
`planDir` / `archiveDir` become `<plansDir>/<slug>` and
`<plansDir>/completed/<archiveName>` (posix, repository-relative). Gate
pathspec is `<plansDir>/` with the trailing slash. Slug extraction strips
that prefix, then applies today's active/archive rules.

**`init --plans-dir`.** Only new flag. Later commands do not accept it.
Validate the value with the same path rules. Write `.planlet.json` only when
the value is not `plans`; `--plans-dir plans` writes no file. If a config
file already exists and `--plans-dir` disagrees, `write_conflict`. Stage the
new file when git is present. Then mkdir the configured directory. Do not
also mkdir `plans/` when the configured directory is elsewhere.

**Snippet.** State the rule, not a resolved path: planlets live in
`plans/<slug>/` unless `.planlet.json` sets `plansDir`. Hash change implies
one consumer `planlet update`.

**Output.** `list` and the dashboard add `plansDir` beside the existing
`plans` array. Do not reuse the `plans` key.

**Migration (docs only).** Operator-run, one commit: `git mv` active
planlets and `plans/completed/` to `<plansDir>/`, add `.planlet.json`, fix
relative links whose targets live outside the planlet by the extra segments.
Completion rewrite is not a relocation rewriter.

## Acceptance Criteria

- No `.planlet.json` keeps `plans/` for every command, including the gate.
- `.planlet.json` with `"plansDir": "docs/plans"` drives create, task check,
  complete, link rewrite, and the gate for that two-segment prefix.
- Unknown JSON keys are ignored; effective `plansDir` is still reported.
- Invalid JSON, non-string `plansDir`, `..`, globs, and reserved YAML/rc
  filenames fail closed with `invalid_config` and do not use the default.
- Missing configured directory is `plans_not_initialized`; the gate still
  returns ok. Leftover `plans/` with a non-default `plansDir` fails the gate
  with `plans_dir_conflict` and does not return ok.
- `init --plans-dir plans` writes no file. `init --plans-dir docs/plans`
  writes `.planlet.json` and creates `docs/plans`, not `plans/`.
- This repository does not gain `.planlet.json`. No YAML parser dependency.

## Verification

- Unit: parser and path validation (absent file, unknown keys, invalid JSON,
  `..`, reserved YAML/rc names, leftover guard vs empty `plans/`).
- Unit: gate slug extraction and pathspec for a two-segment prefix; default
  prefix still matches today's fixtures.
- Integration: `docs/plans` create, task check, complete, and link rewrite;
  missing configured directory vs leftover `plans/` on `check-completion`;
  `init --plans-dir plans` writes no file.
- Existing suite must keep passing with no config file.
- `npm run format:check`, `lint`, `knip`, `type-check`, `build`, `npm test`,
  `git diff --check`.

## Risks and Considerations

- Agent-snippet wording change forces one `planlet update` on consumers.
- Leftover-`plans/` guard false-positives if an unrelated `plans/` of
  subdirectories exists beside a custom `plansDir`. Silent split is worse.
- Transition commit can under-report `completed` because old-path deletions
  fall outside the new pathspec. It must not false-fail.
- A typo key such as `planletsDir` is silent; `list` / dashboard echo the
  effective `plansDir` so the default remains visible.

# Ponytail Scripts/Help Dedup

## Summary

Remove byte-identical duplication in the changelog/release maintainer scripts and the CLI help
surface, per ponytail audit findings 5, 7, 8, 13, and 14. Behavior-preserving: rendered help
text must stay byte-identical, and every script failure string and exit path stays unchanged.

## Scope

- `scripts/assert-changelog-release-ready.mjs`: export the real-date check and duplicate-flag
  counter for reuse; collapse historical and preparation/CI validation into one
  mode-parameterized sequence (finding 13).
- `scripts/release.mjs`: import the shared helpers; delete its local date-check copy; make
  `git()`, `gh()`, `cmdPrepare`, and `cmdTag` plain sync code (finding 14).
- `src/errors/codes.ts` + `tests/unit/errors.test.ts` + `tests/unit/output.test.ts`: derive
  `ErrorCode` from `ERROR_EXIT_CODES`, drop the redundant `ERROR_CODES` array (finding 7).
- `src/cli.ts`: generate the `HELP` Commands block from `COMMAND_HELP` (finding 8).

`src/core/slugs.ts` is not changed: `src/` cannot import from `scripts/`, so the calendar-date
check is shared only between the two scripts.

## Out of Scope

- Findings 1-4, 6, 9-12: shipped in #38 or not part of this batch.
- `AGENTS.md` "Rejected simplifications": `--release-date` and the duplicate-flag pre-scan in
  `assert-changelog-release-ready.mjs` stay as-is. The release script's own copy of the
  pre-scan is shared only through an identical-behavior `countFlags` helper that still rejects
  duplicates before `parseArgs` last-wins semantics can apply.
- The `planlet-lock.ts` pid comment nit: already resolved in #38 (comment now documents pid as
  an opaque debug field).
- README and CHANGELOG, unless the help capture proves a rendering shift (it should not).

## Approach

### T1: Shared calendar-date and duplicate-flag helpers

`assert-changelog-release-ready.mjs` currently executes its CLI body at import time
(`parseArgs`, file reads, `process.exit`), so `release.mjs` cannot import from it directly.
Wrap the direct-run execution behind a run guard (for example
`process.argv[1] !== undefined && fileURLToPath(import.meta.url) === pathToFileURL(resolve(process.argv[1])).href`)
and keep `isValidCalendarDate` and a shared `countFlags(args, prefix)` at module scope as
exports. `release.mjs` imports both and deletes its local `isValidCalendarDate` copy and its
hand-rolled duplicate-flag loop. Spawn-based callers (tests and `release.mjs` itself) are
unaffected because the guard treats direct `node` invocation as a run.

### T2: `ErrorCode` derived from `ERROR_EXIT_CODES`

Delete the 17-line `ERROR_CODES` array and use
`export type ErrorCode = keyof typeof ERROR_EXIT_CODES;`. Tests that iterate codes switch to
`Object.keys(ERROR_EXIT_CODES)` (cast to `ErrorCode[]` where the typed constructor demands it).
The first `errors.test.ts` test ("every stable error code has an exit-code category") becomes
tautological once the array is gone and is deleted; the exact exit-code mapping test stays.
`EXIT_CODES` and `ERROR_EXIT_CODES` values are unchanged.

### T3: Generate the Commands help section from `COMMAND_HELP`

Build the Commands block from `COMMAND_HELP` in insertion order: take each entry's first line
(`Usage: planlet <command> ...`), strip the `Usage: planlet ` prefix, indent two spaces, and
join with newlines. Append a literal `  help [command]` line last. Do not add a `help` entry to
`COMMAND_HELP` — that would change `planlet help help` from a usage error into printed help,
which is outside the approved behavior change. Global-options text and the rest of `HELP`
remain unchanged. Rendered output must be byte-identical to the pre-change capture.

### T4: One mode-parameterized changelog shape check

Replace the duplicated Unreleased-cardinality → bare-suffix → version-section →
`assertValidDatedNotes` sequence with one function parameterized by mode
(`"historical" | "preparation" | "ci"`, where preparation requires `--release-date`):

1. Unreleased cardinality: exactly one, same message in all modes.
2. Unreleased bare suffix: same message in all modes.
3. Empty-Unreleased check: historical always; preparation only under `--release-date`;
   CI never. Mode-specific failure strings are preserved exactly.
4. Version-section cardinality: historical exactly one, preparation exactly one, CI at most
   one with zero sections as early success — each with its current message.
5. Suffix parse and malformed-suffix message (unchanged, including the existing missing-space
   quirk after the colon).
6. `assertValidDatedNotes` with the current label/version arguments.
7. Preparation-only date-mismatch check.

`--date`/`--print-date` handling, `assertNotPast`, and flag validation stay in the CLI branch
of the assert script, unchanged.

### T5: Plain sync wrappers in `release.mjs`

- `git()` and `gh()` return `spawnSync(...)` directly instead of assigning to a local first.
- `cmdPrepare` and `cmdTag` lose `async`; the dispatch calls them synchronously without
  `.catch(fail)`. To preserve today's error rendering for unexpected throws, the dispatch
  wraps the call in a plain `try`/`catch` that routes through `fail()` with the same message
  formatting (or the functions keep all failure paths internal; observable behavior is
  unchanged either way).
- `remoteRefExists` gains an explicit error-path `return false` after `fail()` so its
  boolean contract no longer depends on `fail()` terminating the process.

## Acceptance Criteria

- T1: `release.mjs` imports `isValidCalendarDate` and `countFlags` from the assert script;
  no duplicated date check or duplicate-flag loop remains; importing the assert script does
  not execute its CLI body; direct execution and spawn-based tests behave identically.
- T2: `ERROR_CODES` gone; `ErrorCode` derives from `ERROR_EXIT_CODES`; tests iterate
  `Object.keys(ERROR_EXIT_CODES)`; `type-check`, `lint`, and the error/output unit tests pass.
- T3: before/after captures of `node dist/planlet.mjs --help` are byte-identical
  (`cmp` reports no difference); `planlet help <command>` output is unchanged; `planlet help
  help` still exits with a usage error; README command-table test passes.
- T4: the duplicated sequence exists once; every changelog failure string and exit status is
  unchanged, proven by `tests/integration/changelog.test.ts` passing unmodified.
- T5: no `async`/`await` remains on `cmdPrepare`/`cmdTag`; dispatch calls them directly;
  `git()`/`gh()` return `spawnSync` directly; `tests/integration/release-utility.test.ts`
  passes unmodified.
- T6: full repository suite green; help byte-identity confirmed once more at the end; no
  CHANGELOG entry unless the help capture differs (state that decision in the PR either way);
  planlet archived with all tasks checked.

## Verification

Strategy, in order, per `AGENTS.md`:

`npm run format:check`, `npm run lint`, `npm run knip`, `npm run type-check`,
`npm run build`, `npm test`, `git diff --check`, `git status --porcelain` (empty except
intended planlet/implementation files; `dist/` is gitignored).

Help byte-identity (T3 and final): capture `node dist/planlet.mjs --help` from a fresh build
immediately before the T3 edit and again after, then compare with `cmp`; the capture files are
transient and are not committed. The same check runs once more before completion against the
final build.

Script behavior: `tests/integration/changelog.test.ts` and
`tests/integration/release-utility.test.ts` are the durable pins for exact failure strings and
exit statuses and must pass without modification.

Planlet lifecycle: `create` → populate stubs with this approved content → `validate` →
`task check` per completed task → `complete` to archive under `plans/completed/`.

No `## Verification Evidence` note is planned: all checks are ordinary, reproducible suite
results.

## Risks and Considerations

- Import-time execution: the run guard is the load-bearing piece of T1. If the guard is wrong,
  `release.mjs` would run the changelog CLI at import time; the acceptance test is that a
  direct `release.mjs` invocation still behaves identically.
- Help rendering: byte-identical output is a hard gate. If the capture differs, stop and
  report; that would be a user-visible change requiring a CHANGELOG entry and PR disclosure.
- The no-space quirk in the malformed-suffix message and all other failure strings are
  preserved verbatim; tests pin them.
- Rejected-simplification items are untouched; the shared `countFlags` keeps the
  duplicate-flag threat protection in both scripts.

## Maintaining this guide

N/A — this is a planlet, not an agent guide.

# Codebase Cleanup Pass

## Summary

One focused low-risk cleanup pass across the planlet repo: narrow TOON output
truncation so only the `show --part plan|tasks` content field can be compacted,
record the interactive-init tool-selector decision in the rejected-simplifications
list, delete dead code and speculative config, deduplicate the one pair of
byte-identical mutation-side helpers while preserving the failure-path DI seams,
make file ordering locale-independent, and apply five hygiene fixes. The only
user-visible behavior change is the accepted narrowing of what `--full` means for
`show` and the end of generic output truncation for non-show commands.

## Motivation

The repo accumulated small, independent cruft: a generic output-truncation walk that
over-truncates command payloads, dead script symbols, a duplicated help test, two
copies of byte-identical mutation-side helpers, locale-dependent file ordering
inside a deterministic CLI, and several hygiene smells (prettier drift on
maintained-but-unlisted files, leaked integration-test temp fixtures, bare non-null
map-lookup assertions, an unguarded `realpathSync`, and an assertion against
stringified `"undefined"`). Each item is small; together they reduce maintenance
surface and make the deterministic CLI contract easier to reason about. No feature
work is included.

## Scope

- **F11** Narrow truncation. `src/output/toon.ts` currently runs a recursive
  `truncateLargeStrings` walk that compacts strings anywhere in any command
  payload. Replace that with a field compaction applied only to the `content`
  field of `show --part plan|tasks`. The externally visible compact shape is
  preserved exactly (see Acceptance Criteria). `show --part summary`, and every
  non-show command payload, are emitted complete by default; `--full` returns the
  complete plan or tasks content.
- **F18** Add a rejected-simplifications entry to `AGENTS.md` recording that the
  interactive `init` tool selector is kept deliberately (decision 2026-08-04;
  `--tools` covers non-interactive paths). Docs-only, no code.
- **Mechanical deletions (T3)**: dead `scripts/release.mjs` symbols (`execSync`
  import, `parseVersionSuffix`, `getChangelogReleaseDate`, `escapeRegex`); fake
  `DECISION_RULES` evaluator in `tests/skills/skill-contract.test.ts`; duplicate
  help test in `tests/integration/cli-in-process.test.ts`; add `scripts/**/*.mjs`
  to the `lint` globs in `package.json` (the `format`/`format:check` globs already
  list scripts\); remove boilerplate `forceConsistentCasingInFileNames` from
  `tsconfig.json` (TS default); remove speculative `coverage/` ignores in
  `eslint.config.js`, `.gitignore`, `.prettierignore`.
- **Byte-identical dedup (T4)**: share the mutation-side
  `assertActivePlanletDirectory` and `readMarkdown` helpers between
  `src/core/task-update.ts` and `src/core/planlet-completion.ts`. Make ordering
  locale-independent: replace `localeCompare` with a codepoint comparator in
  `src/core/skill-source.ts` and `src/core/harness-installer.ts`.
- **Hygiene (T5)**, all five concrete targets named below.

## Out of Scope

- The rejected-simplifications the repo defends (lock ownership token + rename-aside
  release, no automatic stale-lock reclaim, hashed lock directory, release-failure
  warning plumbing, structured double-fault error, lock dependency injection,
  `transactionHooks`, `--release-date` pre-scan, harness-installer
  stage/backup/rollback transaction). Left as-is.
- No new CLI features, no planlet file-contract changes, no skill behavior changes,
  no `CHANGELOG` restructuring. The only documented changelog entry this pass adds
  is for F11 (narrowed `--full` output behavior); all other tasks are internal.
- The four `asWriteConflict` definitions are **not** consolidated; see Batch-B
  note below.
- The transaction flows in `creation.ts`, `task-update.ts`, and
  `planlet-completion.ts` are **not** unified behind a single abstraction; see
  Batch-B note below.

## Architectural boundary for F11 output truncation

- `showPlanlet` (`src/commands/read-only.ts:331`) keeps returning raw Markdown:
  `{ slug, part, content: <string>, warnings }` with `content` as a plain string.
  Do not push presentation-specific truncated objects into this read-only domain
  result.
- The compaction helper lives in the output/handler boundary and is applied only
  from the show command path — `handleShow` in `src/commands/handlers.ts:194` —
  when `part === "plan" || part === "tasks"` and `--full` is off.
- `renderToon` (`src/output/toon.ts`) becomes ordinary serialization: remove
  `truncateLargeStrings`, `truncatedString`, the `TruncatedString` shape, and the
  `maxStringCharacters`/`full` handling from `renderToon`. It no longer performs a
  recursive arbitrary-object traversal.
- Keep a cheaply testable maximum-character seam by exposing the field-compaction
  helper (e.g. `compactShowContent(content, maxCharacters)` with
  `DEFAULT_MAX_STRING_CHARACTERS = 4_096`) from the output/handler boundary and
  testing it directly. Do not add production configuration solely for tests.

## Approach

- **Truncation (T1):** keep TOON as the serializer. Stop generic tree-walk
  truncation in `renderToon`; compact only the show `content` field in `handleShow`
  so only genuinely oversized plan/task content is clipped, preserving the existing
  compact chunk with its size metadata and `--full` escape. Confine the change to
  the show output path and its tests, and update the affected user-facing docs
  (README, CLI help, design doc) plus the `[Unreleased]` changelog entry.
- **Decision record (T2):** one bullet in the `AGENTS.md` rejected-simplifications
  list; no code.
- **Mechanical deletions (T3):** pure removals and glob/config trims that leave
  behavior byte-identical; a clean diff an ordinary review can approve.
- **Dedup and ordering (T4):** extract the pair of byte-identical mutation-side
  helpers; replace `localeCompare` with a codepoint comparator so ordering no longer
  depends on host locale. Validate that error messages, structured details, and
  failure-path DI tests are identical before and after.
- **Hygiene (T5):** pin the maintained-but-unlisted drifted files with individually
  justified `.prettierignore` entries instead of reformatting finished work; add
  real teardown to leaking integration-test fixtures; replace bare non-null
  map-lookup assertions with explicit typed lookups; guard the unguarded
  `realpathSync`; fix the `"undefined"` assertion to check real semantics.
- Each PR (T3, T4, T5) lands independently and runs the suite before merge; T6 is
  the closing full-suite gate.

### Batch B note: what does and does not get deduplicated

**Deduplicated (byte-identical, mutation-side only):** `assertActivePlanletDirectory`
and `readMarkdown` are byte-identical in `src/core/task-update.ts` (lines 60 and 76)
and `src/core/planlet-completion.ts` (lines 89 and 66). Extract these two to a shared
module used by both. The distinct candidate-based read helper
`readMarkdown(candidate, filename): string` in `src/commands/read-only.ts:182` is a
different loader and is **explicitly out of scope**; do not touch it.

**Not consolidated:** the four `asWriteConflict` definitions differ in message
template and details shape (creation: "Could not create planlet", details `{slug}`
at `src/core/creation.ts:94`; task-update: "Could not update task",
details `{slug, taskId}` at `src/core/task-update.ts:114`;
planlet-completion: "Could not complete planlet", details `{slug, ...details}` at
`src/core/planlet-completion.ts:156`; harness-installer:
"Could not publish harness installation", details `{destination}` at
`src/core/harness-installer.ts:349`). Parameterizing message and details across all
four makes each call site harder to read than the current local functions, so keep
them local. Acceptance is behavioral, per caller, not a shared-helper requirement.

**Not unified:** the write/publish/rollback flows are not byte-identical.
`creation.ts` stages a temporary *directory* and multiple files before a single
rename; `task-update.ts` publishes one temporary file with the injected `rename`;
`planlet-completion.ts`'s audit publication publishes one temporary file with the
injected `replaceFile` and then runs a distinct audit-then-move orchestration with
resume semantics. A shared "transaction core" across all three would require
callback-heavy, heavily parameterized machinery that obscures the per-operation
errors and DI seams. Leave the flows local. The only genuinely shared mutation logic
is the `assertActivePlanletDirectory`/`readMarkdown` pair above.

### Ordering contract (locale-independent)

Before: `src/core/skill-source.ts:32-34` (`directoryEntries`),
`src/core/harness-installer.ts:88-92` (`sortedRecord`), `:196-198` (visitor), and
`:221-223` (installation `readdir`) sort by `String.prototype.localeCompare`, whose
result depends on the host locale and collator. After: the same arrays sort by a
locale-independent codepoint comparator (e.g. `a < b ? -1 : a > b ? 1 : 0` on the
`name`/key), so the emitted file and record order is identical on every locale and
therefore deterministic. For the ASCII skill/harness names in this repo the
before/after order is unchanged; the change removes the locale dependence rather
than reordering the current outputs. The affected unit tests
(`tests/unit/skill-source.test.ts:36`, `tests/unit/harness-installer.test.ts:39`)
sort their expected values with `localeCompare` and must switch to the codepoint
comparator to match.

## Acceptance Criteria

### F11 exact compact shape

For `show --part plan` and `show --part tasks` whose `content` exceeds the maximum,
the rendered payload carries the `content` field in exactly this shape (all fields
present, with `truncated: true` and the literal hint):

```text
content: {
  preview: "<first N code points>…",
  truncated: true,
  originalCharacters: <total code-point count>,
  shownCharacters: N,
  hint: "Re-run with --full for complete content"
}
```

- Counting and metadata are Unicode code-point based (`Array.from(value).length`),
  unchanged from the current implementation.
- Only the `content` field of `show --part plan|tasks` is compacted. `show --part
  summary` is unaffected. Non-show command payloads are emitted completely by
  default. `--full` returns the complete plan or tasks content as a raw string.
- An implementation that turns truncated `content` into a plain shortened string,
  or that changes any field of this shape, is rejected.

### F11 tests

- Compact `show --part plan`.
- Compact `show --part tasks`.
- Exact existing compact-content schema (the shape above).
- `--full` returning the raw content string.
- `show --part summary` remaining unchanged (no compaction).
- A non-show payload containing a string above the threshold remaining untruncated.

### F11 documentation

- README: replace the "`--full` disables output truncation" claim
  (`README.md:123-124`) with wording that `--full` returns complete
  `show --part plan|tasks` content.
- Top-level CLI help (`src/cli.ts` HELP, global options): state the same
  `--full` behavior clearly.
- Design doc: update the affected claims at `planlet_design.md:598` and `:610`
  that describe `--full` disabling generic truncation; change only the affected
  claims.
- Add a `[Unreleased]` `CHANGELOG.md` entry for this user-visible behavior change.
  No other changelog entry is added by this pass.

### Dedup and ordering

- `assertActivePlanletDirectory` and `readMarkdown` exist once each in the shared
  mutation-side module, and both `task-update.ts` and `planlet-completion.ts` route
  through it. Acceptance is that the identified duplicate mutation logic is gone,
  not a global count of every function named `readMarkdown` (the distinct
  read-only loader stays).
- The four `asWriteConflict` call sites preserve their exact error code
  (`write_conflict`), message, details, `cause`, and the
  pass-through of an existing `PlanletError`. No shared helper is required.
- Every existing fault-injection seam (`write`/`rename`/`replaceFile`/`remove`/
  `temporaryName`, and `now`/`lock`) remains available, and the existing
  failure-path tests still pass unmodified, forcing every distinct filesystem step.
- `localeCompare` is gone from `skill-source.ts` and `harness-installer.ts`; file
  and manifest-record ordering is locale-independent. The affected unit tests use
  the same codepoint comparator.

### Hygiene (concrete targets)

1. **Prettier drift** — the nine maintained-but-unlisted files currently reported
   by `prettier --check` are `.agents/skills/.planlet-manifest.json`,
   `.claude/skills/.planlet-manifest.json`, `planlet_design.md`,
   `plans/completed/2026-07-22-bootstrap-planlet-skills/plan.md`,
   `plans/completed/2026-07-26-packaging-and-polish/plan.md`,
   `plans/completed/2026-08-03-launch-readiness/plan.md`,
   `plans/completed/2026-08-03-launch-readiness/tasks.md`,
   `plans/completed/2026-08-04-release-cut-utility/plan.md`, and
   `tests/fixtures/skills/scenarios.json`. Each gets an individually justified,
   narrowly scoped `.prettierignore` entry (archive/design markdown and generated
   manifests are intentionally not reformatted). `npm run format:check` remains the
   authoritative gate and stays green.
2. **Leaked temp fixtures** — `tests/integration/changelog.test.ts` `fixture()`
   (line ~20) and `tests/integration/release-utility.test.ts:95`
   (`const base = mkdtempSync(...)`) create temp directories that are never removed.
   Add `finally` teardown (`rmSync(dir, { recursive: true, force: true })`); the
   tests still pass and leave no `planlet-changelog-ready-*` / `planlet-release-*`
   dirs behind.
3. **Bare non-null map lookup assertions** — `tests/integration/safety.test.ts`
   lines 184, 271, 312 use `SLUG_COMMANDS[command]!`. Replace with a typed
   lookup that cannot be `undefined` (type the map by command name and index by a
   guaranteed key) so the bare `!` is removed; the test still exercises the same
   commands.
4. **Unguarded `realpathSync`** — `src/core/skill-source.ts:118`
   (`enumerateCanonicalSkills`: `const root = realpathSync(sourceRoot);`) has no
   guard, so an unreadable/missing source throws a raw filesystem error. Guard it
   (try/catch → structured `PlanletError`) consistent with the pattern in
   `src/core/paths.ts`; add/extend a canonical-enumeration test for the structured
   error.
5. **Assertion against stringified `"undefined"`** —
   `tests/integration/safety.test.ts:319` asserts
   `validationErrorCodes(all)` equals `["unsafe_path", "undefined"]`, where the
   `"undefined"` comes from `String(entry.error?.code)` on a valid entry. Replace
   with real semantics (e.g. assert each entry's `error` is absent for valid plans
   rather than coercing `undefined` to a string).

### Verification

- Full suite is green: `npm run format:check && npm run lint && npm run type-check
  && npm run build && npm test`, a clean `git diff --check`, and an empty
  `git status --porcelain`.
- `npm run format:check` is the authoritative formatting gate; `prettier --check .`
  is a one-off informational scan only and is **not** a required acceptance
  criterion (the package scripts are not extended to enforce the nine unlisted
  files permanently).
- For F11, run the focused field-compaction tests plus the integration `--full`
  test.
- For T4, run the existing failure-path/rollback tests unmodified (the
  DI-preservation proof) and confirm no `write_conflict` message text or structured
  field changed.

## Verification

Strategy only — results live in the suite, review, and CI, not here.

- Run
  `npm run format:check && npm run lint && npm run type-check && npm run build && npm test`
  per PR and as the T6 closing gate; expected all green.
- Run `git diff --check` and confirm `git status --porcelain` is empty (build output
  is gitignored). Skim each PR diff to confirm only intended lines changed — no
  leaked tool-output or trailing text in planlet files.
- For the F11 task, run the focused field-compaction tests plus the integration
  `--full` test.
- For T4, rely on the existing failure-path/rollback tests; they must pass
  unmodified (that is the DI-preservation proof). Confirm no `write_conflict`
  message text or structured-error field changed.
- For T3 script changes, run `scripts/release.mjs` help/prepare dry paths and the
  changelog scripts as smoke checks only if the change touches them; disclose when
  a script path was not exercised.
- Confirm `npm run lint` now lint-checks `scripts/**/*.mjs` and `npm run format:check`
  stays green after the glob and `.prettierignore` changes.
- After all PRs, run `node dist/planlet.mjs update` only if `skills/` changed (not
  expected here) and confirm `node dist/planlet.mjs tools` still reports every
  destination as `installed`.
- Confirm the only new `[Unreleased]` changelog entry is the F11 one; confirm
  `planlet validate codebase-cleanup-pass` and `--full show` pass on the persisted
  planlet.

No `## Verification Evidence` note is expected: every outcome is reproducible
through ordinary git, test, review, and CI history.

## Risks and Considerations

- **F11 `--full` semantic change:** accepted. Non-show commands no longer truncate
  and `--full` affects only the compacted `show` field. Users/reviewers relying on
  generic truncation elsewhere will see full content by default — intended.
- **T4 DI seams:** the shared `assertActivePlanletDirectory`/`readMarkdown` helpers
  take no DI and must not swallow errors; the existing failure-path tests are the
  proof. Completion's audit-then-move and resume semantics stay untouched.
- **Ordering change:** codepoint ordering removes locale dependence but is a subtle
  change; the affected unit tests must switch comparators in the same change.
- **Lint-scope glob addition** may newly surface issues in `scripts/**/*.mjs` once
  linted; expect and fix those within T3.
- **Changelog:** only F11 adds an entry; the rest are internal/chore and must not
  be written to `CHANGELOG.md`.

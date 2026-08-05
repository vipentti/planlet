# Tasks: Codebase Cleanup Pass

- [x] T1 Narrow TOON output truncation to `show --part plan|tasks` content: make
      `renderToon` ordinary serialization, compact only the show `content` field in
      `handleShow` preserving the existing compact schema (`preview`,
      `truncated: true`, `originalCharacters`, `shownCharacters`, `hint`), leave
      `show --part summary` and non-show payloads complete, make `--full` return
      the raw content string, test the field-compaction helper directly, and add
      tests (compact plan, compact tasks, exact schema, `--full` raw, summary
      unchanged, non-show untruncated). Update README/CLI-help/design-doc `--full`
      wording and add the `[Unreleased]` changelog entry.
- [x] T2 Record the interactive-init tool-selector decision in AGENTS.md
- [x] T3 Mechanical deletions PR (no behavior change): remove dead
      `scripts/release.mjs` symbols (`execSync`, `parseVersionSuffix`,
      `getChangelogReleaseDate`, `escapeRegex`), the fake `DECISION_RULES`
      evaluator in `tests/skills/skill-contract.test.ts`, and the duplicate help
      test in `tests/integration/cli-in-process.test.ts`; add `scripts/**/*.mjs`
      to the `lint` globs in `package.json`; and update the README dev-command
      table and the AGENTS.md repository-command table so lint is described as
      covering source files, tests, and maintainer scripts rather than only
      TypeScript source and tests; remove the boilerplate
      `forceConsistentCasingInFileNames` from `tsconfig.json`; remove speculative
      `coverage/` ignores in `eslint.config.js`, `.gitignore`, `.prettierignore`.
- [x] T4 Refactor PR: share the byte-identical mutation-side
      `assertActivePlanletDirectory` and `readMarkdown` helpers between
      `src/core/task-update.ts` and `src/core/planlet-completion.ts` (the distinct
      read-only loader in `src/commands/read-only.ts` stays out of scope); replace
      `localeCompare` with a codepoint comparator in `src/core/skill-source.ts`
      and `src/core/harness-installer.ts` so ordering is locale-independent, and
      switch the affected unit-test expectations to the same comparator. Preserve
      every fault-injection seam and keep the four local `asWriteConflict`
      definitions and the per-operation transaction flows unchanged.
- [x] T5 Hygiene fixes: classify the drifted files by ownership — narrowly ignore
      the generated manifests (`.agents/skills/.planlet-manifest.json`,
      `.claude/skills/.planlet-manifest.json`; their generator owns formatting)
      and the `plans/completed/**` archive-policy pattern (completed planlets are
      immutable audit records; documented policy, not five one-off entries); format
      the maintained source artifacts `planlet_design.md` and
      `tests/fixtures/skills/scenarios.json` (exact paths, not a broad JSON glob)
      and add both to `npm run format` and `npm run format:check` in
      `package.json` so the commands stay symmetric; add teardown to the leaked
      temp fixtures in `tests/integration/changelog.test.ts` (both the
      `planlet-changelog-ready-*` fixture roots and the direct
      `planlet-changelog-*` root) and to the outer `base` fixture in
      `tests/integration/release-utility.test.ts` (`planlet-release-*`, removing
      the whole outer root not just its nested `work` repo); replace the bare
      `SLUG_COMMANDS[command]!` lookups in `tests/integration/safety.test.ts`
      (184, 271, 312); guard canonical-skill source canonicalization and
      enumeration errors at `src/core/skill-source.ts:118` with tests for a missing
      source and a path that resolves but cannot be enumerated (regular-file
      `ENOTDIR` case); fix the stringified-`"undefined"` assertion at
      `safety.test.ts:319`. Keep `npm run format:check` as the authoritative
      formatting gate.
- [x] T6 Run the full repository verification suite end-to-end
      (format:check, lint, type-check, build, test, git diff --check, clean
      `git status --porcelain`)

## Completion

- Completed at: 2026-08-05T07:11:31.457Z
- Mode: normal

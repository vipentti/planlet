# CLI-First Skills

## Summary

Remove every CLI-unavailable fallback instruction from the three canonical skills and their
references so the skills require an available `planlet` executable and never hand-reimplement
lifecycle operations. Retire the Phase 0 fallback requirement in `planlet_design.md` (D2) and
sweep the whole repository for any other outdated fallback references, updating them in the same
change (captain approval 2026-08-05). No product code changes.

## Scope

In scope:

- Replace the three "announce fallback" workflow steps (report sketch A) in
  `skills/planlet-plan/SKILL.md`, `skills/planlet-implement/SKILL.md`, and
  `skills/planlet-complete/SKILL.md` with one shared CLI-required step: install via
  `npm install -g @vipentti/planlet` or invoke via `npx @vipentti/planlet`; if it still cannot
  run, stop and report, naming the missing executable; never reimplement CLI operations by
  editing planlet files.
- Delete manual create/validate/task-check/complete/move fallback prose across the five skill
  files (sketches B-G): the three "When fallback was used" Finish sentences, the plan SKILL
  manual-creation paragraph, the implement SKILL fallback checkbox step plus its guidance
  "Validate the target manually" and safe-write sections, the complete SKILL manual-completion
  wording and manual archive step, and the completion-guidance "Validate the target manually",
  "Record one completion instant", and "Move safely" sections. Keep the completion-record shape
  as read-only reference and the audit-semantics sentence.
- Reword the surviving direct-edit passages so each names why no CLI command covers it, or names
  the harness constraint (T3 keep-list: create-stub population, direct revision, evidence notes,
  read-before-edit, checkbox-bullet rule).
- Update `tests/skills/skill-contract.test.ts` to assert the CLI-required contract, forbid
  `fallback` wording, and keep the `init|update|tools|archive` guard.
- Regenerate and commit harness copies, add a `CHANGELOG.md` `[Unreleased]` entry, amend
  `planlet_design.md` Phase 0 and Phase 2 sections (D2), and sweep the whole repository (docs,
  evaluations, `AGENTS.md`, `planlet_design.md`, README, comments, tests, scripts) for any other
  outdated CLI-unavailable-fallback references, updating each in the same change (C1 + expanded
  sweep).

Out of scope:

- No product code, no CLI changes, no new dependencies, no new lifecycle behavior.
- No changes to `skills/planlet-plan/references/planning-guidance.md`, the asset templates,
  `skills/*/agents/openai.yaml`, or `tests/fixtures/skills/scenarios.json` (all verified clean
  during drafting).
- Offline/airgapped handling follows D1: stop and report; no hand-managed planlet files.
- Unrelated uses of "manual" or "fallback" (lock recovery, repository-root fallback, release
  manual steps) stay untouched; the sweep targets only the retired CLI-unavailable lifecycle
  fallback.

## Approach

- Apply report sketches A-G as written, with one verified adjustment: sketch G's caveat is
  resolved. `src/core/planlet-completion.ts` emits exactly the documented record fields
  (`## Completion`, `Completed at`, `Mode`, optional `Remaining tasks`, `Reason`) and
  `src/core/completion.ts` parses the same shape, so deleting the instruction templates is safe.
  Retitle the section "Read the completion record", keep "Refuse a pre-existing or conflicting
  completion record" and the audit-versus-verification sentence verbatim.
- Replace the implement fallback checkbox step (sketch D) with the "never edit a checkbox by
  hand" rule; `task check`/`task uncheck` own checkbox state and errors are stops, never
  authorization to edit.
- Replace both "Validate the target manually" sections (sketch E) with "Trust the CLI as the
  target authority": `validate`, `list`, `tasks`, and `status` are the only authorities on
  existence, activity, and well-formedness; a non-zero exit is a workflow failure to report.
- Contract test: reword the test title (line 46), replace the two fallback assertions (lines
  80-84) with assertions for the new CLI-required sentence, add
  `assert.doesNotMatch(markdown, /fallback/i)`, and confirm `npm install -g @vipentti/planlet`
  and `npx @vipentti/planlet` do not trip the line-85 `planlet (?:init|update|tools|archive)\b`
  regex (verified during drafting: they do not).
- T5 ordering: run `npm run build`, then `node dist/planlet.mjs update --tools all`, commit the
  regenerated `.claude/skills/planlet-*` and `.agents/skills/planlet-*` trees, add the changelog
  entry, and amend `planlet_design.md` around lines 1078-1083 (Phase 0 bullets and paragraph)
  and 1101 (Phase 2 bullet) to record that the fallback is retired and skills require an
  available executable.
- Repo sweep: run `rg -n -i "fallback|manual"` across the repository (excluding `node_modules/`
  and `dist/`), classify each hit as retired CLI-unavailable lifecycle fallback versus unrelated
  semantics, and update only the retired-fallback references: `AGENTS.md` §Current repository
  state, `evaluations/skills/scenarios.md` review criteria, any README or design-doc mention,
  and any comments or test names that describe the old skill fallback. Unrelated uses stay, with
  the classification recorded in the PR description.

## Acceptance Criteria

- T1: All three SKILL.md files carry the same CLI-required step (install via `npm install -g
  @vipentti/planlet` or `npx @vipentti/planlet`; stop and report naming the missing executable
  if it still cannot run; never reimplement CLI operations by editing planlet files), and no
  "announce fallback" step remains.
- T2: No fallback prose remains in the five skill files: the three Finish sentences, plan SKILL
  manual-creation paragraph, implement checkbox fallback step and guidance fallback sections,
  complete manual-completion wording and archive step, and completion-guidance record/move
  instructions are gone; completion guidance keeps the record shape as read-only reference with
  the audit-semantics sentence intact.
- T3: Every remaining direct file-edit instruction names its CLI gap or harness constraint; no
  surviving sentence implies a fallback.
- T4: `npm test` green; the contract test asserts the CLI-required sentence and
  `doesNotMatch(/fallback/i)` across all three SKILL.md files; the `init|update|tools|archive`
  guard still passes with the new install/npx wording.
- T5: `node dist/planlet.mjs update --tools all` leaves the tracked `.claude/skills/planlet-*`
  and `.agents/skills/planlet-*` copies byte-identical to canonical (contract test covers),
  copies are committed, `CHANGELOG.md` `[Unreleased]` has a `Changed` entry for the skill
  behavior, `planlet_design.md` records the fallback retirement, and the repo-wide sweep finds
  no remaining CLI-unavailable-fallback reference in docs, evaluations, `AGENTS.md`,
  `planlet_design.md`, README, comments, tests, or scripts; unrelated manual/fallback uses are
  preserved.

## Verification

Run the full suite gate from AGENTS.md in order: `npm run format:check`, `npm run lint`, `npm run
knip`, `npm run type-check`, `npm run build`, `npm test`, `git diff --check`, then `git status
--porcelain` clean (build output is gitignored). Skill parity is verified by regenerating with
`node dist/planlet.mjs update --tools all` and by the byte-identical-copies contract test. The
repo sweep is verified by `rg -n -i "fallback|manual"` classification with unrelated uses
preserved. No `## Verification Evidence` section is expected: routine results live in tests,
review, and CI.

## Risks and Considerations

- D1 is a standing no: no fallback wording may be reintroduced, including in the new T3
  rewording; the only acceptable offline handling is stop-and-report.
- Contract-test regex collision: the new install/npx wording was checked against the
  `init|update|tools|archive` guard during drafting and does not match; re-verify after the
  final edit.
- Regenerated harness copies must be committed in the same change or the CI drift-check step
  fails.
- Published-skill behavior change requires the `CHANGELOG.md` entry per AGENTS.md.
- The design-doc amendment must record retirement without leaving Phase 0/Phase 2 language that
  re-authorizes a fallback.
- The repo sweep must not overreach into unrelated manual-recovery or repository-root fallback
  semantics; classification is part of the acceptance evidence.

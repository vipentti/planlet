# Tasks: CLI-First Skills

- [x] T1 Replace the three "announce fallback" workflow steps with the shared CLI-required step in `skills/planlet-plan/SKILL.md`, `skills/planlet-implement/SKILL.md`, and `skills/planlet-complete/SKILL.md`: install via `npm install -g @vipentti/planlet` or `npx @vipentti/planlet`; stop and report naming the missing executable if it still cannot run; never reimplement CLI operations by editing planlet files
- [x] T2 Delete the manual create/validate/task-check/complete/move fallback prose from the five skill files (sketches B-G): Finish sentences, plan SKILL manual paragraph, implement checkbox fallback plus both "Validate the target manually" sections, complete manual-completion wording and archive step, and completion-guidance record/move sections, keeping the completion-record shape as read-only reference
- [x] T3 Reword surviving hand-edit passages (create-stub population, direct revision, evidence notes, read-before-edit, checkbox-bullet rule) so each names why no CLI command covers it or names the harness constraint, with no fallback implication
- [x] T4 Update `tests/skills/skill-contract.test.ts`: rename the fallback test, replace fallback assertions with CLI-required assertions, add `assert.doesNotMatch(markdown, /fallback/i)`, and confirm the install/npx wording does not trip the `init|update|tools|archive` regex
- [x] T5 Regenerate and commit tracked copies via `node dist/planlet.mjs update --tools all`, add `CHANGELOG.md` `[Unreleased]` entry, amend `planlet_design.md` Phase 0/2 to record fallback retirement (D2), and sweep the whole repo for outdated fallback references (docs, evaluations, AGENTS.md, README, comments, tests, scripts), updating each in the same change (C1 + expanded sweep)

## Completion

- Completed at: 2026-08-05T09:44:22.882Z
- Mode: normal

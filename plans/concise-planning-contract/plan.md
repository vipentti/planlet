# Concise planning contract

## Summary

Rework the planlet-plan skill so planning guidance and templates teach a
concise planning contract: plan.md states each material requirement once and
tasks.md is a compact execution index that never repeats the plan, with a
companion implement-side statement making the layering explicit. Wording-only
change across five skill files plus one skill metadata alignment.

## Scope

- Replace `## Develop the proposal` steps 3, 5, and 6 in
  `skills/planlet-plan/SKILL.md`; steps 1, 2, and 4 and every other section
  stay unchanged.
- Replace `skills/planlet-plan/references/planning-guidance.md`,
  `assets/plan-template.md`, and `assets/tasks-template.md`.
- Add one companion paragraph to `skills/planlet-implement/SKILL.md` after
  Start workflow step 5.
- Align `skills/planlet-plan/agents/openai.yaml` `short_description` with the
  SKILL.md frontmatter description.
- Regenerate committed `.agents/skills` and `.claude/skills` copies; add a
  `CHANGELOG.md` Unreleased entry.
- No CLI, product code, test, or design-document changes.

## Approach

The captain's draft at
`/home/ville/repos/mate/data/planlet-concise-planning-proposal/draft.md` is
the content source of truth; apply each replacement verbatim. Deviations,
per captain decisions: write the declined-confirmation sentence on one line
because `tests/skills/skill-contract.test.ts` asserts it as a raw-content
substring; keep step 4 unchanged because the draft's step 4 is byte-identical
to the current one; treat the terse-template sentence after the draft's
section 4 fence as commentary, not file content.

## Acceptance Criteria

- The skill files match the draft, with the declined-confirmation sentence on
  one line and `openai.yaml` aligned with the frontmatter description.
- `planlet --root . tools` reports every destination installed; the CI
  skill-drift step passes.
- `npm test` passes, including scenario evidence, template contract, and
  byte-identical copies.
- `planlet validate concise-planning-contract` passes with the planned state.

## Verification

Run the full suite: `npm run format:check`, `npm run lint`, `npm run knip`,
`npm run type-check`, `npm run build`, `npm test`, `git diff --check`.
Regenerate copies with `node dist/planlet.mjs update` and re-run
`planlet tools` after the edits. Prettier does not cover `skills/`, so no
formatting gate applies to the replaced files.

## Risks and Considerations

Skill-contract tests assert scenario evidence phrases as raw substrings of the
skill corpus; the draft's step 6 line wrap is the one known breakage,
corrected per Approach. Future edits to these sections must keep the pinned
phrases intact.

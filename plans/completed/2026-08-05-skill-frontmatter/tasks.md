# Tasks: Skill Frontmatter

- [x] T1 Add the three frontmatter fields to the three canonical skills
  - Acceptance: `skills/planlet-plan/SKILL.md`, `skills/planlet-implement/SKILL.md`,
    and `skills/planlet-complete/SKILL.md` each carry
    `allowed-tools: Bash(planlet:*)`, `compatibility: Requires planlet CLI.`,
    and `license: MIT` after `description`, with `name` still first and no
    other frontmatter fields added.
  - Verification: read each frontmatter block; `git diff` shows only the three
    canonical SKILL.md files, three added lines each.
- [x] T2 Relax the skill-contract test and confirm fixture scope
  - Acceptance: `tests/skills/skill-contract.test.ts:32` uses
    `assert.match(markdown, /\ndescription: \S.+/);`, the `name`-first
    assertion is unchanged, and no frontmatter strings exist in
    `tests/fixtures/skills/scenarios.json` or `evaluations/`.
  - Verification: targeted run of the canonical-skill metadata test; full-suite
    gate is T3 because the byte-identity tests expect regenerated copies.
- [x] T3 Regenerate installed copies and manifests, add the changelog entry,
      and run the full suite
  - Acceptance: `.agents/skills/` and `.claude/skills/` copies byte-identical
    to canonical files; both `.planlet-manifest.json` digest sets updated;
    `CHANGELOG.md` `[Unreleased]` entry present; full suite green; PR diff
    contains only intended files. Optional: one sentence in
    `planlet_design.md` section 14.
  - Verification: `npm run build`, `node dist/planlet.mjs --root . update --tools all`,
    `node dist/planlet.mjs --root . tools` (all destinations installed), then
    `npm run format:check`, `npm run lint`, `npm run knip`,
    `npm run type-check`, `npm run build`, `npm test`, `git diff --check`.

## Completion

- Completed at: 2026-08-05T12:27:15.797Z
- Mode: normal

# Tasks: Concise planning contract

- [ ] T1 Replace `## Develop the proposal` steps 3, 5, and 6 in `skills/planlet-plan/SKILL.md` with the draft content, writing the declined-confirmation sentence on one line; keep steps 1, 2, and 4 and all other sections unchanged.
- [ ] T2 Align `skills/planlet-plan/agents/openai.yaml` `short_description` with the SKILL.md frontmatter description: "Explore, propose, create, or revise one repository-local Planlet without implementing product changes".
- [ ] T3 Replace `skills/planlet-plan/references/planning-guidance.md` with the draft's section 2 content verbatim, preserving the pinned evidence phrases such as the 2–4 decision batch guidance.
- [ ] T4 Replace `skills/planlet-plan/assets/plan-template.md` with the draft's section 3 content, keeping the five required headings Summary, Scope, Approach, Acceptance Criteria, and Verification.
- [ ] T5 Replace `skills/planlet-plan/assets/tasks-template.md` with the draft's section 4 fenced content only; the trailing terse-template note is draft commentary and stays out of the file.
- [ ] T6 Add the companion paragraph stating plan.md is the authoritative design and acceptance contract and tasks.md its execution index to `skills/planlet-implement/SKILL.md` immediately after Start workflow step 5.
- [ ] T7 Regenerate installed skill copies with `node dist/planlet.mjs update` and confirm `planlet --root . tools` reports every destination installed.
- [ ] T8 Add a `CHANGELOG.md` entry under `[Unreleased]` describing the concise planning contract: plan.md owns each requirement once and tasks.md is an execution index, with the implementation skill's companion statement.
- [ ] T9 Run the full verification suite: format check, lint, knip, type check, build, npm test, and git diff check; all must pass before this task is checked.

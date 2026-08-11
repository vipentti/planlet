# Tasks: Concise planning contract

- [x] T1 Replace `## Develop the proposal` steps 3, 5, and 6 in `skills/planlet-plan/SKILL.md` with the draft content from the plan's Verbatim draft section, writing the declined-confirmation sentence on one line; keep steps 1, 2, and 4 and all other sections unchanged.
- [x] T2 Replace `skills/planlet-plan/references/planning-guidance.md` with the draft's section 2 content from the plan's Verbatim draft section verbatim, preserving the pinned evidence phrases such as the 2–4 decision batch guidance.
- [x] T3 Replace `skills/planlet-plan/assets/plan-template.md` with the draft's section 3 content from the plan's Verbatim draft section, keeping the five required headings Summary, Scope, Approach, Acceptance Criteria, and Verification.
- [ ] T4 Replace `skills/planlet-plan/assets/tasks-template.md` with the draft's section 4 fenced content from the plan's Verbatim draft section only; the trailing terse-template note is draft commentary and stays out of the file.
- [ ] T5 Add the companion paragraph stating plan.md is the authoritative change-specific design and acceptance contract and tasks.md its execution index to `skills/planlet-implement/SKILL.md` immediately after Start workflow step 5.
- [ ] T6 Regenerate installed skill copies with `node dist/planlet.mjs update` and confirm `planlet --root . tools` reports every destination installed.
- [ ] T7 Add a `CHANGELOG.md` entry under `[Unreleased]` describing the concise planning contract: plan.md owns each requirement once and tasks.md is an execution index, with the implementation skill's companion statement.
- [ ] T8 Run the full verification suite. Every command must exit 0 except `npm test` may reproduce exactly the two known `package-artifact.test.ts` failures under npm 12.0.2; no other test failure is permitted.

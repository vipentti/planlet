# Tasks: Strengthen Plan Skill Discovery

- [ ] T1 Revise `skills/planlet-plan/SKILL.md` with short hybrid-discovery workflow steps under existing H2 sections only (batch cadence, recommended answers, fact-vs-decision, precise fast path, handoff quality); keep detail in guidance
- [ ] T2 Update `skills/planlet-plan/references/planning-guidance.md` for discovery stance and small independently verifiable tasks, preserving all skill-contract-pinned verification phrases and forbidden-command constraints
- [ ] T3 Align `planlet_design.md` §14.1 discovery responsibility; keep §8.1 step list numbering and precise-request fast-path paragraph
- [ ] T4 Update `tests/fixtures/skills/scenarios.json` vague-planning and precise-planning evidence (including batch/recommendation substrings); keep existing expectedDecision labels unless a rename is unavoidable
- [ ] T5 Update `evaluations/skills/scenarios.md` S1/S2 expected decisions to the hybrid discovery stance
- [ ] T6 Build CLI, run `node dist/planlet.mjs update`, confirm installed `.agents` / `.claude` planlet-plan copies match canonical sources
- [ ] T7 Run full verification suite including `git status --porcelain`; touch `tests/skills/skill-contract.test.ts` only if decision labels must change, and fix any remaining contract/scenario failures

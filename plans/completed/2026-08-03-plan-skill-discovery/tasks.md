# Tasks: Strengthen Plan Skill Discovery

- [x] T1 Revise `skills/planlet-plan/SKILL.md` with short hybrid-discovery workflow steps under existing H2 sections only (batch cadence, recommended answers, fact-vs-decision, precise fast path, handoff quality); keep detail in guidance
- [x] T2 Update `skills/planlet-plan/references/planning-guidance.md` for discovery stance (prefer about 2–4 related decisions per batch) and small independently verifiable tasks, preserving all skill-contract-pinned verification phrases and forbidden-command constraints
- [x] T3 Replace `planlet_design.md` §14.1 “Ask only questions…” with the Scope draft richer-discovery responsibility (or equivalent); keep §8.1 step list numbering and precise-request fast-path paragraph
- [x] T4 Update `tests/fixtures/skills/scenarios.json` vague-planning and precise-planning evidence (including batch/recommendation substrings); keep existing expectedDecision labels unless a rename is unavoidable
- [x] T5 Update `evaluations/skills/scenarios.md` S1/S2 expected decisions to the hybrid discovery stance
- [x] T6 Build CLI, run `node dist/planlet.mjs update`, then `node dist/planlet.mjs tools` and confirm every planlet skill destination reports as `installed`
- [x] T7 Run full verification suite including `git status --porcelain`; touch `tests/skills/skill-contract.test.ts` only if decision labels must change, and fix any remaining contract/scenario failures

## Completion

- Completed at: 2026-08-03T06:32:45.627Z
- Mode: normal

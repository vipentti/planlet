# Tasks: Compact Task Index Contract

- [ ] T8 Codify compact-index ownership and structural-versus-authoring distinction in the authoritative design.
  - Scope: `planlet_design.md` §10.4 and §14.1, including `Verify:` versus explicit verification task.
- [ ] T1 Rewrite the canonical tasks template as an execution index with `Scope:` and `Verify:` bullets.
  - Scope: `skills/planlet-plan/assets/tasks-template.md`, including its HTML comment.
- [ ] T2 Replace task-length wording in planning guidance with the ownership split, metadata-field rule, word targets, and parser non-goal.
  - Scope: `skills/planlet-plan/references/planning-guidance.md`.
- [ ] T3 Add the pre-presentation compression pass to the planning workflow.
  - Scope: `skills/planlet-plan/SKILL.md` proposal steps.
- [ ] T4 Regenerate and commit installed skill copies.
  - Verify: `node dist/planlet.mjs update` then `tools` reports every destination installed.
- [ ] T5 Update skill contract assertions for the new template and guidance terms.
  - Verify: `npm test`, `tests/skills/skill-contract.test.ts`.
- [ ] T6 Add the `[Unreleased]` changelog entry for the skill behavior change.
- [ ] T7 Run the full repository verification suite defined in `plan.md`.

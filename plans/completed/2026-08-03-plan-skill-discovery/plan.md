# Strengthen Plan Skill Discovery

## Summary

Update `planlet-plan` so vague requests get a short hybrid discovery pass before a proposal, while precise requests stay lean. Strengthen guidance so persisted plans and tasks are clear handoffs: small, independently implementable, easy for a typical agent to validate.

## Motivation

Current skill text biases toward minimal clarifying questions. That under-serves vague requests and can yield thin plans or oversized tasks. External grilling/explore skills inspire better discovery without turning Planlet into a separate explore mode or endless interrogation.

## Scope

- Canonical `skills/planlet-plan/SKILL.md`: short hybrid-discovery workflow steps under existing H2 sections only (no new H2); small batches of related decisions (one-at-a-time only when answers depend on each other); recommend an answer with each decision; look up facts in the repo instead of asking; keep precise-request fast path; keep confirmation-before-write and no-product-code rules. Put rationale and detail in guidance, not a long SKILL.md.
- Canonical `skills/planlet-plan/references/planning-guidance.md`: match that stance; prefer about 2–4 related decisions per discovery batch; stress handoff clarity and small, verifiable tasks. Preserve skill-contract-pinned phrases verbatim (`Verification` is strategy, not a run log; never paste logs; Committed verification evidence is exceptional and absent by default). Do not name `planlet init`, `update`, `tools`, `archive`, `evidence`, or `verify` inside the skill corpus even though install sync runs `planlet update` outside that text. Keep existing quoted `--root` CLI forms and other contract forbids intact.
- Align `planlet_design.md` §14.1 by replacing “Ask only questions that materially affect the plan” with draft responsibility text: for vague or incomplete requests, surface material open decisions (outcome, boundaries, constraints, acceptance, verification, task sizing) in small related batches with a recommended answer; look up repository facts instead of asking; for precise requests, skip ceremonial questions and proceed to analysis and proposal. Keep §8.1 step 3 and the precise-request fast-path paragraph; do not renumber §8.1’s list so the §14.1 “§8.1 step 10” cross-reference stays valid.
- Update `tests/fixtures/skills/scenarios.json` vague-planning and precise-planning evidence strings, including substrings that pin small-batch and recommended-answer behavior. Keep existing `expectedDecision` labels (`clarify-material-unknowns`, `propose-without-extra-questions`); prefer not renaming `DECISION_RULES` in `tests/skills/skill-contract.test.ts`.
- Update manual eval `evaluations/skills/scenarios.md` S1/S2 expected decisions to the hybrid stance.
- Regenerate installed `.agents/skills/planlet-*` and `.claude/skills/planlet-*` copies with `node dist/planlet.mjs update` after canonical edits.

## Out of Scope

- New skill, CLI commands, or templates redesign.
- Copying OpenSpec/grilling wording, examples, or product-specific mechanics.
- Changing `planlet-implement` or `planlet-complete` workflows.
- Open-ended explore-forever stance or mandatory one-question-at-a-time grilling.
- Renaming scenario decision labels when evidence-only updates suffice.

## Approach

Keep Planlet’s combined explore+propose skill and confirmation boundary. Replace “ask only material unknowns / skip if precise” as the sole discovery rule with a clearer two-path stance:

1. **Vague or incomplete request** — investigate the repo first; surface open decisions that affect outcome, boundaries, constraints, acceptance, verification, or task sizing; ask in small related batches (prefer about 2–4 decisions; one-at-a-time only when answers depend on each other) with a recommended answer; narrow into a concrete proposal only after those decisions are settled enough for a fresh agent handoff.
2. **Precise request** — skip ceremonial questions; inspect the repo; propose plan + small tasks directly.

In guidance, define “small task” as one delivered outcome a typical agent can implement and verify without guessing scope, and state the 2–4 batch-size preference so agents neither grill one-by-one by default nor dump a mega-questionnaire. Keep progressive disclosure: edit existing `SKILL.md` H2 sections only (no new H2); put rationale/batching/task-sizing detail in `planning-guidance.md`. For §14.1, use the Scope draft (or equivalent) so implementers need not invent the responsibility wording from scratch. Write Planlet instructions independently of the inspiration sources. After canonical edits, sync installed copies and keep scenario evidence phrases in lockstep with new skill text so contract/scenario checks stay green. Treat batch/recommendation behavior as fixture-pinned evidence, not review-only.

## Acceptance Criteria

- Vague requests trigger discovery before proposal; precise requests still avoid ceremonial questions.
- Discovery uses small related batches by default (prefer about 2–4 related decisions); one-at-a-time only when answers depend on each other; recommendations accompany decision questions; facts come from the repo when possible. Vague-planning fixture evidence includes substrings covering batch and recommended-answer behavior.
- Guidance requires plans/tasks sufficient for a fresh-session handoff and tasks small enough to implement and validate independently, and states the batch-size preference.
- `SKILL.md` gains no new H2 section; discovery workflow stays under existing headings, with rationale and task-sizing detail in `planning-guidance.md`.
- Test-pinned verification sentences and forbidden command names remain intact in the planlet-plan corpus.
- `planlet_design.md` §14.1 uses the richer-discovery responsibility wording (Scope draft or equivalent) and no longer contradicts hybrid discovery; §8.1 numbering and precise-request fast path remain.
- Scenario fixtures and eval S1/S2 match the new wording; decision labels stay unless a rename is unavoidable.
- Installed skill copies match canonical sources after `node dist/planlet.mjs update` / `node dist/planlet.mjs tools`.
- Planning still never writes before confirmation and never implements product code.

## Verification

- `npm run format:check`
- `npm run lint`
- `npm run type-check`
- `npm run build`
- `npm test` (includes skill-contract and scenario evidence checks)
- `node dist/planlet.mjs update` regenerates installed skill copies after canonical edits
- `node dist/planlet.mjs tools` reports every planlet skill destination as `installed`
- `git diff --check`
- `git status --porcelain` (expect empty after committed work, or only intentional planlet/product diffs during implementation; catches T6 half-done install drift)
- Manual review of skill/guidance/design/eval diffs for portability (no vendor-specific tool dependence) and no copied external skill prose

## Risks and Considerations

- Over-prescriptive discovery can reintroduce ceremony; keep precise-path and material-decision filters explicit.
- Scenario evidence strings are brittle substring matches; update them with the skill text in the same change.
- Rewriting `planning-guidance.md` can silently break skill-contract asserts; preserve pinned phrases on every edit.

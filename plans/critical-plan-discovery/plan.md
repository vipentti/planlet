# Critical Plan Discovery

## Summary

`planlet-plan` resolves ambiguity inside the direction the user proposes, but
never asks whether that direction solves the right problem. A request such as
"add Redis caching to speed up the CLI" yields a Redis plan without first
checking where the time goes or whether removing repeated filesystem reads
would do.

This planlet strengthens discovery in the existing skill: separate the problem
from the proposed solution, challenge assumptions the repository does not
support, order questions by dependency, make recommendations actionable, and
stop asking once a fresh implementer could proceed without product decisions.
The goal is better questions, not more of them. The file-first workflow from
the completed `file-first-planning` planlet stays as is.

## Scope

Changes:

- `skills/planlet-plan/SKILL.md`: rework step 2 of Develop the proposal, and
  step 3 where it overlaps, to carry the Approach rules below. Keep steps 4-7,
  Start the workflow, Persist or revise, and Finish unchanged.
- `skills/planlet-plan/references/planning-guidance.md`: add a short discovery
  section only if SKILL.md cannot hold the rules concisely; otherwise leave it
  unchanged.
- `planlet_design.md`: review §8.1, §14.1, and §20.3; edit only text that is now
  wrong or inconsistent with the new skill wording.
- `evaluations/skills/scenarios.md`: recheck S1-S3 and add two planning
  scenarios (see Acceptance Criteria).
- `tests/fixtures/skills/scenarios.json` and
  `tests/skills/skill-contract.test.ts`: update evidence strings that the
  rewording breaks, and add fixture entries for the two new scenarios.
- Regenerated tracked installed copies under `.claude/skills/planlet-plan/`,
  `.agents/skills/planlet-plan/`, and their `.planlet-manifest.json` files, as
  output of `node dist/planlet.mjs update`.
- `CHANGELOG.md` under `[Unreleased]`: published-skill behavior change.

Excluded:

- A separate explore, grill, or discovery skill; `planlet-plan` stays one
  combined discovery and planning skill (`planlet_design.md` §8.1).
- New planning artifacts, decision-tree documents, template sections, CLI
  changes, configuration, or dependencies. No file under `src/` changes.
- A minimum question count or exhaustive traversal of every decision branch.
- `planlet-implement`, `planlet-complete`, `README.md`,
  `skills/planlet-plan/agents/openai.yaml`, `AGENTS.md`, and `CLAUDE.md`.
- Copying external skill wording, examples, or mechanics; external skills
  inform ideas only, per `AGENTS.md`.

## Approach

**Problem first.** Before choosing an implementation, separate the underlying
problem, desired outcome, real constraints, and the user's proposed solution.
Treat a proposed solution as a hypothesis unless the user states it as a
requirement. Check it against repository evidence; when a simpler or better
targeted alternative exists, or the solution adds disproportionate complexity,
say so constructively and recommend the alternative. Challenge unsupported
assumptions, not stated decisions: a solution the user justifies or requires
is respected.

**Dependency-ordered questions.** Ask outcome and scope before the technical
choices that depend on them, and hold a downstream question until its
prerequisite is settled. Ask only questions whose answers materially change the
plan. Keep the existing small related batches of about 2-4 decisions and the
rule to look up discoverable facts instead of asking. No formal design tree.

**Actionable recommendations.** Every material decision question carries one
recommended answer with a brief rationale grounded in repository findings, and
names a meaningful alternative or tradeoff only when one exists. The user can
accept a single recommendation or a whole batch at once. Never invent
alternatives or assume preferences the context does not support. Record
recommendations the user did not confirm as assumptions, not as user
decisions.

**Stop condition.** Stop asking when a fresh implementation agent could
understand the desired outcome, scope, chosen approach, acceptance criteria,
and verification without making consequential product decisions. Then persist
directly under the existing file-first rules. Precise requests still skip
questions; minor ambiguity is settled by a stated reasonable assumption;
unresolved material decisions are still asked before `planlet create`.

**Concision.** Fold these rules into existing steps rather than adding
sections or repeating guidance. Keep strings the contract tests pin, the
canonical CLI policy, and the ban on naming `planlet init`, `update`, `tools`,
or `archive` inside the skill corpus.

## Acceptance Criteria

- `planlet-plan` `SKILL.md` states each Approach rule: problem-first separation
  with proposed solutions as hypotheses, challenging assumptions but not
  justified decisions, dependency-ordered questions, recommendation with
  rationale and batch acceptance, recommendations kept distinct from confirmed
  decisions, and the fresh-implementer stop condition.
- The precise-request fast path, discussion-only exception, questions-before-
  files rule, direct persistence without a confirmation round, and brief
  Finish report are unchanged in behavior.
- `planlet_design.md` has no statement contradicting the new discovery
  behavior.
- `evaluations/skills/scenarios.md` covers the five cases: vague problem
  needing discovery (S1); precise request needing no questions (S2);
  discussion-only request leaving the repository unchanged (S3); a specific
  technical solution resting on an assumption the fixture contradicts, where
  the agent investigates, challenges it, and recommends the simpler fix; and a
  user unfamiliar with the choices who accepts a batch of recommendations,
  which the agent then persists without further questions. Existing scenario IDs
  keep their numbers; new ones take IDs above S11.
- The scenario fixture pins skill wording for the two new cases, and contract
  tests pass.
- Installed skill copies and manifests match canonical sources.
- `CHANGELOG.md` `[Unreleased]` describes the behavior change.

## Verification

Full repository suite in the documented order: `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`,
`npm test`, `git diff --check`, then `git status --porcelain`.

Targeted:

- `node dist/planlet.mjs --root . tools` reports every destination
  `installed` after `node dist/planlet.mjs update`.
- Read the reworked Develop the proposal section against each of the five
  scenarios and confirm the expected behavior follows from the text.

The evaluation scenarios are manual agent runs; this plan updates their
expectations but does not require running them.

## Risks and Considerations

- Over-challenging: the agent may second-guess clear decisions or add
  questions. The decisions-versus-assumptions rule, the stop condition, and the
  precise-request scenario guard against that.
- Skill length: more rules dilute attention. Keep the net addition to
  SKILL.md small and avoid restating guidance already present.

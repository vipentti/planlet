# File-First Planning

## Summary

`planlet-plan` currently presents the full proposed plan and tasks in the
conversation and asks for confirmation before writing either file. Most plans
are then written unchanged, so the agent emits the plan twice and the user
reviews it in the worse medium.

This planlet makes planning file-first: once material decisions are settled,
the skill creates and populates `plan.md` and `tasks.md` directly, validates
them, and reports briefly. The persisted files are reviewable drafts, not
approval to implement. Implementation stays a separate, later request.

## Scope

Changes:

- `skills/planlet-plan/SKILL.md`: replace the present-and-confirm step (Develop
  the proposal step 7), the "new confirmed planlet" and "confirmed revision"
  wording under Persist or revise, the "Before presenting" timing of the
  compression pass, and the Finish report contract.
- `skills/planlet-plan/references/planning-guidance.md`: replace the
  "Review before persistence" section and the "Before presenting" timing of the
  compression pass paragraph.
- `planlet_design.md`: align §8.1 steps 8-10 and the confirmation-boundary
  paragraph after them, §14.1 responsibilities and must-not list, and §23
  criteria 2-3.
- `evaluations/skills/scenarios.md`: rewrite S1-S3 and recheck S4 per
  Acceptance Criteria.
- `tests/fixtures/skills/scenarios.json` and
  `tests/skills/skill-contract.test.ts`: update evidence strings, the
  `declined-persistence` scenario id, and the compression-step assertions that
  pin "Before presenting" and "Present the proposed plan", so the contract
  tests track the new wording.
- Regenerated tracked installed copies under `.claude/skills/planlet-plan/`,
  `.agents/skills/planlet-plan/`, and both `.planlet-manifest.json` files, as
  output of `node dist/planlet.mjs update`.
- `CHANGELOG.md` under `[Unreleased]`: published-skill behavior change.

Excluded:

- CLI, parser, validator, and any file under `src/`. `planlet create`,
  `validate`, and `show` already support the workflow.
- New configuration, flags, a `draft` approval state, or a separate planning
  mode.
- `planlet-implement` and `planlet-complete`. The incomplete-completion
  confirmation in `planlet-complete` is unrelated and stays.
- `README.md` and `skills/planlet-plan/agents/openai.yaml`; both already
  describe planning as persisting a reviewable planlet.
- `AGENTS.md`, `CLAUDE.md`, and the generated agent onboarding snippet.

## Approach

**Three separate acts.** Creating a plan is not approving it, and approving it
is not implementing it. Writing the two planning files needs no extra
confirmation; starting implementation remains a separate user request, as
`planlet_design.md` §8.3 already states.

**New workflow.** Investigate the repository and ask material clarification
questions first, using the existing batching and recommended-answer rules.
When the decisions needed for a fresh-session handoff are settled, or the
request is already precise, run `planlet create`, populate both stubs, run the
compression pass on the drafted `tasks.md`, then `validate` and re-read both
files with full `show`. The compression pass moves from "before presenting"
to "before persisting"; its procedure is unchanged.

**Questions before files, not after.** Unresolved material decisions are asked
before creation. The skill never writes a plan and then asks whether to keep
it.

**Brief report.** The final response gives the logical slug, paths written or
revised, exact validation result, warnings, and only consequential assumptions
or unresolved concerns. It never reproduces the plan or task list and never
asks for confirmation to write.

**Discussion-only requests.** When the user explicitly asks to brainstorm,
compare options, or keep a proposal conversational without saving, the skill
answers in conversation and leaves the repository unchanged. Absent such a
request, persistence is the default.

**Revisions.** A revision request authorizes editing the existing files
directly. All existing revision rules stay: re-read before editing, preserve
stable IDs, allocate new IDs above the highest suffix, never silently remove
completed work, reconcile both files, then validate and re-read.

**Preserved safeguards.** Slug validation, collision refusal, never using
`create` to overwrite, ambiguous-target selection, CLI failure handling,
required-CLI policy, and the no-product-implementation boundary are unchanged.
Harness filesystem permission prompts still apply; only the skill's own
confirmation step is removed.

## Acceptance Criteria

- Neither skill file nor planning guidance tells the agent to present the full
  plan in conversation or obtain confirmation before writing a new or revised
  planlet.
- The skill states that persisted files are reviewable drafts and that
  implementation needs a separate request.
- The skill keeps material clarification questions before `planlet create`
  and states the explicit discussion-only exception.
- The Finish contract matches the brief report described in Approach.
- `planlet_design.md` §8.1, §14.1, and §23 describe file-first planning with no
  remaining confirmation-before-persistence boundary for `planlet-plan`.
- `evaluations/skills/scenarios.md` covers: a precise request persisting
  directly; a vague request clarifying, then persisting; an explicit
  discussion-only request leaving the repository diff empty; and S4 revision
  safety unchanged except for dropping any confirmation step.
- Contract tests and the scenario fixture reference the new wording and pass.
- Installed skill copies and manifests match canonical sources.
- `CHANGELOG.md` `[Unreleased]` describes the behavior change.
- No file under `src/` changes.

## Verification

Full repository suite in the documented order: `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`,
`npm test`, `git diff --check`, then `git status --porcelain`.

Targeted:

- `node dist/planlet.mjs --root . tools` reports every destination
  `installed` after `node dist/planlet.mjs update`.
- Search `skills/planlet-plan/` and `planlet_design.md` §8.1, §14.1, §23 for
  leftover confirm-before-write or present-before-write wording.
- `tests/skills/skill-contract.test.ts` passes with the updated
  compression-step and scenario assertions.

The evaluation scenarios are manual agent runs; this plan updates their
expectations but does not require running them.

## Risks and Considerations

- Users who relied on the in-conversation preview now review files instead.
  The discussion-only exception covers anyone who wants a conversational
  proposal.
- An agent may persist too early on a vague request. The questions-first rule
  and S1 scenario guard against that.

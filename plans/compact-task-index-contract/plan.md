# Compact Task Index Contract

## Summary

Planning guidance already calls `tasks.md` a compact execution index, already
assigns detailed requirements to `plan.md`, and the canonical tasks template is
already three short one-line outcomes. What is missing are the controls that
make the stated intent bite: the length targets are permissive (about 60 words
per task, escalation only near 100), and nothing tells the planner to compress
the draft index before presenting it.

This planlet tightens those two controls in the planning skill and locks the
compact template shape with regression assertions. Duplicated specifications
drift; the narrowed change is the smallest one that removes the room to
duplicate.

## Scope

Changes:

- `skills/planlet-plan/references/planning-guidance.md`: replace the 60/100-word
  wording with 25/50-word targets and add the pre-presentation compression pass.
- `skills/planlet-plan/SKILL.md`: name the compression pass in the step that
  precedes presenting the proposal, referring to the guidance for detail.
- Regenerated tracked installed copies, as generated outputs of
  `planlet update`: `.claude/skills/planlet-plan/`,
  `.agents/skills/planlet-plan/`, `.claude/skills/.planlet-manifest.json`, and
  `.agents/skills/.planlet-manifest.json`.
- `tests/skills/skill-contract.test.ts`: structural assertions for the compact
  template properties and the new guidance controls.
- `CHANGELOG.md` under `[Unreleased]`: published-skill behavior change.

Excluded, with reasons:

- `assets/tasks-template.md` rewrite. The current template already demonstrates
  short one-line outcomes; no concrete text in it contradicts the tightened
  rule, so it is locked by tests rather than rewritten.
- New standard `Scope:` metadata field. No repository evidence shows existing
  ownership guidance failing in a way a named field would fix, and a named field
  is itself a duplication surface.
- `planlet_design.md`. Its §10.4 template is already short one-line outcomes and
  its rules do not contradict the tightened targets, so no alignment edit is
  needed. Revisit only if implementation finds contradicting text.
- Parser, validator, or CLI changes. Word targets are authoring guidance with no
  enforcement and no new error code.
- `planlet-implement` and `planlet-complete` skills; existing planlets under
  `plans/completed/`.

## Approach

**Ownership split (restated, not changed).** `plan.md` is the specification:
design decisions, boundaries, invariants, acceptance criteria, detailed
behavior, edge cases, and broad verification strategy. `tasks.md` orders
delivered outcomes with unique stable T-IDs, prerequisites before consumers.

**Word targets.** A checkbox sentence preferably 25 words or fewer; a complete
task normally 50 words or fewer. These replace "about 60 words" and "approaching
100 words". They are planner judgment targets, not thresholds any tool measures.

**Compression pass.** Before presenting a proposal, the planner rereads the
draft `tasks.md` against `plan.md` and deletes every detail an implementer can
recover unambiguously from `plan.md`. Only detail whose removal would leave the
outcome or its ownership genuinely ambiguous survives.

**Task-local metadata is exceptional.** A bare outcome line is the default and
the exemplar. The existing short `Verify:` clause stays available, and stays
what guidance already calls it: used only when useful, when it makes the task
shorter or clearer and the information is not recoverable from `plan.md`. Broad
suite execution belongs to the distinct final verification task, never to a
task-local clause. Ordinary nested Markdown lists remain allowed sparingly and
must not become another specification surface. The ownership split does this
work regardless of Markdown label, so no new named metadata field is introduced
and none is governed by name.

**Preserved semantic exceptions.** A task with multiple independent outcomes is
split rather than compressed. Substantial explanation moves into `plan.md`
rather than being deleted. Compression relocates detail, never drops a
requirement.

**Layering.** Operational detail lives in `planning-guidance.md`; `SKILL.md`
stays a workflow trigger pointing at it; the template demonstrates shape without
repeating rationale or enforcement disclaimers.

**Parser evidence.** Indented nested Markdown continuation and checkbox mutation
already work: `parseTasks` consumes indented continuation lines and nested
lists, and existing tests cover that behavior and task checking. Nothing in this
plan needs a `src/` change.

## Acceptance Criteria

- `planning-guidance.md` states the 25/50-word targets, the compression pass as
  a step before the proposal is presented, task-local metadata as exceptional
  rather than the normal shape, the sparing-nested-list allowance, and both
  semantic exceptions.
- The retired "about 60 words" and "approaching 100 words" wording is gone.
- Guidance states that no parser or validator enforces any of this.
- `SKILL.md` names the compression pass before presentation and defers detail to
  the guidance.
- `node dist/planlet.mjs update` output is included in the same changeset: both
  skill destinations and both `.planlet-manifest.json` files.
- `tests/skills/skill-contract.test.ts` asserts the compact template properties
  and the new guidance controls structurally, without matching exact prose.
- `CHANGELOG.md` carries an `[Unreleased]` entry for the skill behavior change.
- No file under `src/` changes.

## Verification

Repository suite, in the documented order: `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`,
`npm test`, `git diff --check`. Then `git status --porcelain` as inspection
only: expect no unexpected paths, accepting staged or unstaged planlet and
implementation changes when the workflow grants no commit authority.

Targeted:

- Contract assertions in `tests/skills/skill-contract.test.ts`, in the existing
  corpus-assertion style: template tasks are single-line and short, guidance
  mentions the compression pass and the tightened targets, and the retired
  60/100 wording is absent.
- The existing `validatePlanletStructure` template test must still pass with
  tasks `T1`-`T3`, proving no parser change is implied.
- Regeneration order: `npm run build` first, because `dist/` is gitignored and a
  fresh implementation checkout has no built CLI to run. Then
  `node dist/planlet.mjs update` and `node dist/planlet.mjs --root . tools`:
  every destination reports `installed`, and both manifests plus both skill
  copies appear in the changeset. CI also fails on drift. The final full suite
  stays in T7 and runs its own build.

Known limitation: the word targets and the compression pass have no automated
check by design, so conformance is reviewer judgment.

## Risks and Considerations

Published-skill behavior change: downstream repositories pick up the tightened
targets on `planlet update`. Existing planlets stay valid because the parser
contract is untouched, so the only effect is stylistic inconsistency between old
and new task files, which needs no migration.

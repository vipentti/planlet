# Compact Task Index Contract

## Summary

Generated `tasks.md` files currently restate `plan.md` detail: modes, frame
sequences, error strings, steering sequences, and case lists. The cause is the
canonical tasks template, whose prose-shaped example invites a second
specification, not a lack of guidance wording. This planlet redefines the
authored contract so `tasks.md` is a compact execution index, updates the
canonical tasks template and planning guidance to demonstrate and require that
shape, and leaves CLI parsing untouched.

When complete, the planning skill produces task lists of short imperative
outcomes with at most two standard nested metadata bullets, and a planner
applies an explicit compression pass before presenting any proposal.

## Scope

Changes:

- `skills/planlet-plan/assets/tasks-template.md`: rewrite the example task list
  and its HTML comment.
- `skills/planlet-plan/references/planning-guidance.md`: replace the current
  task-length wording with the ownership split, nested-field allowlist, word
  targets, and compression pass.
- `skills/planlet-plan/SKILL.md`: align the "Develop the proposal" task wording
  and add the compression pass to the pre-presentation step.
- Regenerated installed copies under `.claude/skills/planlet-plan/` and
  `.agents/skills/planlet-plan/` (produced by `planlet update`, committed).
- `tests/skills/skill-contract.test.ts`: assertions for the new contract, if the
  existing template test needs updating.
- `CHANGELOG.md` under `[Unreleased]`: published-skill behavior change.

Excluded:

- Parser, validator, or CLI changes of any kind. Word limits are authoring
  guidance only; there is no enforcement and no new error code.
- `planlet-implement` and `planlet-complete` skills.
- Rewriting existing planlets under `plans/completed/`.
- `plan-template.md`, which already owns the specification sections correctly.

## Approach

**Ownership split.** `plan.md` is the single specification: design decisions,
boundaries, invariants, acceptance criteria, detailed behavior, edge cases, and
broad verification strategy. `tasks.md` is an execution index: ordered delivered
outcomes, unique stable T-IDs, prerequisites before consumers. A task states
*what outcome lands*, never *how the behavior is specified*.

**Nested-field allowlist.** Exactly two nested bullets are permitted under a
checkbox, both optional:

- `Scope:` likely components or ownership boundaries.
- `Verify:` targeted commands, test suites, or behavior categories.

No other nested field is introduced or accepted, explicitly not
`Requirements:`, `Details:`, `Implementation:`, `Cases:`, or equivalents; such
fields are the invitation that produces copied specification. The existing
`Verify:` inline clause form stays valid; the nested bullet is the preferred
form when metadata is present.

**Word targets.** Checkbox sentence preferably 25 words or fewer; a complete
task including nested bullets normally 50 words or fewer. These replace the
current "about 60 words / approaching 100 words" wording. They are targets a
planner applies with judgment, not thresholds any tool measures.

**Compression pass.** Before presenting a proposal, the planner rereads the
draft `tasks.md` against `plan.md` and deletes every detail an implementer can
recover unambiguously from `plan.md`. Only detail whose removal would leave the
outcome or its ownership genuinely ambiguous survives.

**Preserved semantic exceptions.** A task with multiple independent outcomes is
split rather than compressed. Substantial explanation moves into `plan.md`
rather than being deleted. Compression never drops a requirement; it relocates
or already has it stated in `plan.md`.

**Rationale to carry into the guidance.** Representative failure: a planlet for
a fake-worker feature in which each task re-listed the worker modes, the frame
sequence, and the exact error strings already fixed in `plan.md`, roughly
tripling `tasks.md` while adding no decision an implementer could not read one
file over. Two specifications that can drift is the cost; the index shape is the
fix.

**Template shape.** The rewritten `tasks-template.md` demonstrates short
imperative outcomes, one task carrying a `Scope:` bullet and one carrying a
`Verify:` bullet, and keeps three tasks (T1-T3) so the existing structural
contract test continues to hold. Its HTML comment states plainly that tasks are
an execution index and not a second specification, and keeps the existing
parser-shape facts (one physical checkbox line, nested checkbox syntax invalid).

## Acceptance Criteria

- `tasks-template.md` shows short imperative outcomes with at least one `Scope:`
  and one `Verify:` nested bullet, and no other nested field.
- The template's HTML comment states that `tasks.md` is not a second
  specification and retains the current parser-shape facts.
- `planning-guidance.md` states the ownership split, the two-field allowlist as
  a closed set, the 25/50 word targets, the compression pass, and both semantic
  exceptions, and no longer states the 60/100 word wording.
- `planning-guidance.md` or `SKILL.md` names the compression pass as a step that
  runs before the proposal is presented.
- Guidance and template state explicitly that no parser or validator enforces
  word counts or the nested-field allowlist.
- `skills/`, `.claude/skills/`, and `.agents/skills/` copies are byte-identical
  (`planlet tools` reports every destination `installed`).
- `CHANGELOG.md` carries an `[Unreleased]` entry for the skill behavior change.
- No file under `src/` changes.

## Verification

Repository suite, in the documented order: `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`,
`npm test`, `git diff --check`, `git status --porcelain` empty.

Targeted:

- `tests/skills/skill-contract.test.ts` covers the template through
  `validatePlanletStructure`; the rewritten template must still parse to
  `planned` with tasks `T1`-`T3`, proving the new shape needs no parser change.
- Add contract assertions for the new guidance terms (allowlist, compression
  pass, word targets) and a negative assertion that the retired 60/100 wording
  is absent, matching the existing corpus-assertion style in that file.
- `node dist/planlet.mjs --root . tools` after `node dist/planlet.mjs update` to
  confirm no drift between canonical and installed skill copies; CI also fails
  on drift.
- Manual read-through: generate or hand-check one sample `tasks.md` against the
  new template to confirm the compression pass produces a materially shorter
  index than the current prose shape.

Known limitation: word targets and the nested-field allowlist have no automated
check by design, so conformance is reviewer judgment.

## Risks and Considerations

Published-skill behavior change: downstream repositories pick up the new task
shape on `planlet update`. Existing planlets stay valid because nothing about
the parser contract changes, so the risk is stylistic inconsistency between old
and new task files, which is acceptable and not worth a migration.

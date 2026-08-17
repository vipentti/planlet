# Compact Task Index Contract

## Summary

Generated `tasks.md` files currently restate `plan.md` detail: modes, frame
sequences, error strings, steering sequences, and case lists. The cause is the
canonical tasks template, whose prose-shaped example invites a second
specification, not a lack of guidance wording. This planlet redefines the
authored contract so `tasks.md` is a compact execution index, codifies that
contract in the authoritative design plus the planning guidance and template,
and leaves CLI parsing untouched.

When complete, the planning skill produces task lists of short imperative
outcomes carrying at most the two standard named metadata fields, and a planner
applies an explicit compression pass before presenting any proposal.

## Scope

Changes:

- `planlet_design.md` §10.4 and §14.1: distinguish structural CLI validity from
  generated authoring convention, codify compact-index ownership for `tasks.md`,
  and clarify when `Verify:` metadata suffices versus when significant
  verification belongs in its own explicit task (reconciling the existing
  "verification should appear as explicit tasks when it is significant" rule).
- `skills/planlet-plan/assets/tasks-template.md`: rewrite the example task list
  and its HTML comment.
- `skills/planlet-plan/references/planning-guidance.md`: replace the current
  task-length wording with the ownership split, metadata-field rule, word
  targets, and compression pass.
- `skills/planlet-plan/SKILL.md`: align the "Develop the proposal" task wording
  and add the compression pass to the pre-presentation step.
- Regenerated installed copies under `.claude/skills/planlet-plan/` and
  `.agents/skills/planlet-plan/` (produced by `planlet update`, committed).
- `tests/skills/skill-contract.test.ts`: assertions for the new contract.
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

**Standard metadata fields.** Exactly two named metadata fields exist, both
optional:

- `Scope:` likely components or ownership boundaries.
- `Verify:` targeted commands, test suites, or behavior categories.

No other named metadata field may be introduced, explicitly not
`Requirements:`, `Details:`, `Implementation:`, `Cases:`, or equivalents; such
fields are the invitation that produces copied specification. This is a rule
about named fields, not a ban on nesting: ordinary nested Markdown lists remain
allowed sparingly where they make a task shorter or clearer, and must not become
another specification surface. The existing `Verify:` inline clause form stays
valid; the nested bullet is the preferred form when metadata is present.

**`Verify:` versus a verification task.** `Verify:` carries a targeted pointer
that fits one short line, naming the command, suite, or behavior category that
proves that one task's outcome. Verification that is itself significant work,
such as new fixtures, a new suite, or the broad completion run, stays a distinct
explicit task, as the design already requires.

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

**Rationale.** Duplicated specifications drift. That single sentence is the
whole justification carried into published guidance; no historical anecdote.

**One durable owner per layer.** `planlet_design.md` states the product-level
rule: structural validity is what the CLI parser accepts, compact-index
authoring convention is a separate generated-content contract, and `tasks.md`
owns execution order rather than specification. `planning-guidance.md` holds the
operational detail: metadata fields, word targets, compression pass, exceptions.
`SKILL.md` stays a workflow trigger that points at the guidance.
`tasks-template.md` demonstrates the shape and does not repeat rationale or
enforcement disclaimers.

**Template shape.** The rewritten `tasks-template.md` demonstrates short
imperative outcomes, one task carrying a `Scope:` bullet and one carrying a
`Verify:` bullet, and keeps three tasks (T1-T3) so the existing structural
contract test continues to hold. Its HTML comment says tasks are an execution
index, not a second specification, and keeps the existing parser-shape facts
(one physical checkbox line, nested checkbox syntax invalid).

## Acceptance Criteria

- `planlet_design.md` §10.4 separates structural CLI validity from compact-index
  authoring convention, and states when `Verify:` metadata suffices versus when
  significant verification is its own task, consistently with §14.1.
- `tasks-template.md` shows short imperative outcomes with at least one `Scope:`
  and one `Verify:` nested bullet, and no other named metadata field.
- The template's HTML comment states that `tasks.md` is not a second
  specification and retains the current parser-shape facts.
- `planning-guidance.md` states the ownership split, `Scope:`/`Verify:` as the
  only standard named metadata fields with the prohibited names called out, the
  sparing-nested-list allowance, the 25/50 word targets, the compression pass,
  and both semantic exceptions, and no longer states the 60/100 word wording.
- `planning-guidance.md` or `SKILL.md` names the compression pass as a step that
  runs before the proposal is presented.
- Guidance states explicitly that no parser or validator enforces word counts or
  the metadata-field rule; the template does not repeat that disclaimer.
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
- Add contract assertions for the new guidance terms (standard metadata fields,
  compression pass, word targets) and a negative assertion that the retired
  60/100 wording is absent, matching the existing corpus-assertion style in that
  file. Nested-list and checkbox-mutation parser behavior is already covered by
  existing tests and needs no new `src/` support.
- `node dist/planlet.mjs --root . tools` after `node dist/planlet.mjs update` to
  confirm no drift between canonical and installed skill copies; CI also fails
  on drift.
- Manual read-through: generate or hand-check one sample `tasks.md` against the
  new template to confirm the compression pass produces a materially shorter
  index than the current prose shape.

Known limitation: word targets and the metadata-field rule have no automated
check by design, so conformance is reviewer judgment.

## Risks and Considerations

Published-skill behavior change: downstream repositories pick up the new task
shape on `planlet update`. Existing planlets stay valid because nothing about
the parser contract changes, so the risk is stylistic inconsistency between old
and new task files, which is acceptable and not worth a migration.

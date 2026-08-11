# Concise planning contract

## Summary

Rework the planlet-plan skill so planning guidance and templates teach a
concise planning contract: plan.md states each material requirement once and
tasks.md is a compact execution index that does not duplicate detailed plan
requirements, with a companion implement-side statement making the layering
explicit. Wording-only change across five skill files.

## Scope

- Replace `## Develop the proposal` steps 3, 5, and 6 in
  `skills/planlet-plan/SKILL.md`; steps 1, 2, and 4 and every other section
  stay unchanged.
- Replace `skills/planlet-plan/references/planning-guidance.md`,
  `assets/plan-template.md`, and `assets/tasks-template.md`.
- Add one companion paragraph to `skills/planlet-implement/SKILL.md` after
  Start workflow step 5.
- Regenerate committed `.agents/skills` and `.claude/skills` copies; add a
  `CHANGELOG.md` Unreleased entry.
- No CLI, product code, test, or design-document changes.

## Approach

The verbatim draft in the Verbatim draft section below is the content source
of truth; apply each replacement verbatim. Deviations, per approved
decisions: write the declined-confirmation sentence on one line because
`tests/skills/skill-contract.test.ts` asserts it as a raw-content substring;
keep step 4 unchanged because the draft's step 4 is byte-identical to the
current one; treat the terse-template sentence after the draft's section 4
fence as commentary, not file content. This plan embeds the verbatim draft as
an exceptional wording-preservation case: the exact skill wording is itself
the target artifact, and the source exists only outside the repository; it is
not an example of default desired planlet verbosity.

The guidance file is implemented as a condensed version of the draft's
section 2 per review feedback: pinned evidence phrases preserved, duplicated
ownership restatements and numeric word thresholds removed. The Verbatim
draft remains the planning-time source of truth.

## Verbatim draft

````markdown
# Draft: concise Planlet planning contract (source of truth, 2026-08-10)

## 1. `skills/planlet-plan/SKILL.md`

Keep file unchanged except for `## Develop the proposal`.

Replace current steps 3 through 6 with:

```markdown
3. Define the outcome, scope, exclusions, approach, acceptance criteria,
   verification, and meaningful risks. Compare options only when the choice
   matters. Keep `plan.md` static: verification records strategy, never results
   of a past or future run.

   Treat `plan.md` as the authoritative change-specific design and acceptance
   contract for this planlet, subject to applicable repository instructions and
   higher-level design documents. State each material requirement once in the
   most appropriate section instead of repeating it across Scope, Approach,
   Acceptance Criteria, Verification, and tasks.

4. Propose a descriptive slug matching
   `^[a-z0-9]+(?:-[a-z0-9]+)*$` and verify that its logical slug is unused among
   active and completed planlets.

5. Turn the proposal into `plan.md` and a compact execution index in
   `tasks.md`. An implementer is expected to read both files before starting:
   `plan.md` owns design decisions, boundaries, invariants, acceptance criteria,
   and broad verification strategy; `tasks.md` orders the delivered outcomes
   needed to realize that plan.

   Keep each task small enough that a typical agent can implement and verify
   one outcome without guessing its ownership. Do not duplicate detailed plan
   requirements in tasks. Prefer one concise task sentence; include likely
   components or task-specific verification only when they materially reduce
   ambiguity. If a task needs a long explanation or many independent
   requirements, move shared detail into `plan.md` or split the task.

   Read [planning guidance](references/planning-guidance.md) and use the
   templates in [plan-template.md](assets/plan-template.md) and
   [tasks-template.md](assets/tasks-template.md).

6. Present the proposed plan and tasks in conversation. Outside the proposed
   file content, keep commentary brief: call out only material assumptions,
   exclusions, unresolved decisions, or tradeoffs that need review. Do not
   restate the plan in a second narrative summary. Obtain explicit confirmation
   before writing either file. If confirmation is declined or absent, leave the
   repository unchanged.
```

Everything else in `SKILL.md` stays unchanged.

---

## 2. `skills/planlet-plan/references/planning-guidance.md`

Replace file with:

```markdown
# Planning Guidance

## Investigate efficiently

Read repository instructions, relevant source and tests, package or build
metadata, and nearby plans before recommending work. Trace current behavior far
enough to identify integration boundaries and verification surfaces. Do not edit
product files during this workflow.

Look up repository facts instead of asking.

For a vague or incomplete request, surface material open decisions that affect
outcome, boundaries, constraints, acceptance, verification, or task sizing.
Ask in small related batches and prefer about 2-4 related decisions per
discovery batch. Ask one-at-a-time only when answers depend on each other.
Include a recommended answer with each decision.

Narrow into a concrete proposal only after those decisions are settled enough
for a fresh agent handoff. If the request is already precise, proceed without
ceremonial questions.

## Optimize for human review

Write the smallest plan that preserves consequential decisions.

A reviewer should be able to determine:

- what changes,
- why the chosen approach is reasonable,
- which boundaries and invariants matter,
- what observable behavior defines success,
- how success will be verified.

Prefer short paragraphs and bullets for distinct requirements. State an
important rule once, then rely on that statement elsewhere rather than
rephrasing it.

Avoid:

- repeating the same requirement in Scope, Approach, Acceptance Criteria,
  Verification, and Tasks,
- exhaustive implementation walkthroughs,
- exhaustive test-case matrices when a smaller set of behavioral categories
  communicates the same contract,
- historical reasoning after a decision has been settled,
- incidental filenames, function names, or edit sequences an implementer can
  safely discover from the repository,
- defensive repetition intended only to make every section independently
  self-contained.

More text is useful only when removing it would create a consequential
ambiguity.

## Give each kind of information one home

Use the planning files as complementary layers, not duplicate specifications.
`plan.md` is authoritative for change-specific design; repository instructions
and higher-level design documents take precedence when they explicitly
constrain the plan.

`plan.md` owns:

- intended outcome,
- scope and exclusions,
- architectural or behavioral decisions,
- global invariants and compatibility constraints,
- observable acceptance criteria,
- broad verification strategy,
- material risks.

`tasks.md` owns:

- implementation sequence,
- one delivered outcome per task,
- likely component or boundary when useful,
- task-specific verification when useful.

An implementer is expected to read both files completely. A task therefore
needs to be understandable in the context of `plan.md`; it does not need to
repeat all applicable plan requirements.

## Shape a focused plan

A useful `plan.md` lets a capable agent continue in a fresh session with enough
outcome, boundaries, acceptance, and verification detail for an independent
handoff.

Normally include Summary, Scope, Approach, Acceptance Criteria, and
Verification. Add Motivation, Out of Scope, Risks and Considerations, Rejected
Alternatives, or other sections only when they remove ambiguity or prevent
scope drift.

Keep implementation details at the level needed for a reliable handoff. Name
important components, interfaces, migrations, compatibility constraints, and
test boundaries when they affect the chosen design. Do not prescribe incidental
edits that repository inspection can resolve safely during implementation.

Keep global invariants in the plan rather than copying them into every task.
When several tasks are governed by one safety, compatibility, migration, or
ordering rule, state that rule once in Approach or Acceptance Criteria.

Acceptance criteria describe observable finished behavior. Prefer statements a
reviewer or automated check can prove. Include negative behavior and
compatibility expectations when material. Do not turn Acceptance Criteria into
a second implementation task list.

## Keep verification proportional

`Verification` is strategy, not a run log.

Name stable repository commands or check categories, their expected outcomes,
external gates a reviewer must see, and known limitations. Group related edge
cases into behavioral categories instead of enumerating every fixture unless
the exact matrix is itself part of the contract.

Broad verification belongs in `plan.md`. A task may name a short targeted check
when that check is specific to the task, but should not repeat the complete
verification matrix.

Do not record execution results in `plan.md` and never paste logs. A later
strategy or scope change is a plan revision, not an execution journal entry.

Committed verification evidence is exceptional and absent by default. Tests,
lint, type-checking, builds, ordinary pull-request review, and branch-protected
CI already hold their own results, so a plan must not ask an implementer to copy
them into `tasks.md`.

Expect a `## Verification Evidence` note only when the plan foresees a durable
fact that ordinary Git, test, pull-request, or CI history cannot reconstruct
adequately: external, irreversible, non-reproducible, failed, partial, or
unavailable verification whose residual result affects a later decision. Say so
explicitly in Verification when the plan expects one, and stay silent otherwise.

## Build compact, stable tasks

Map the chosen approach and acceptance criteria to an ordered checklist of
verifiable outcomes.

For each task:

- Describe one delivered result, not an agent thought process.
- Make the task understandable after reading `plan.md`; do not make it a
  self-contained mini-specification.
- Name important files or components only when doing so materially reduces
  search or ambiguity.
- Include a short `Verify:` clause only when verification is specific to that
  task.
- Refer to a named plan section when necessary instead of copying its detailed
  requirements.
- Separate meaningful verification into its own task when it spans several
  implementation outcomes or gates overall completion.
- Order prerequisites before their consumers without dependency notation.
- Use unique IDs beginning with `T1` for a new planlet.

Prefer one concise sentence per task. Most tasks should fit within about 60
words. A task approaching 100 words should trigger a review: move shared
requirements into `plan.md`, remove duplication, or split genuinely independent
outcomes. There is no minimum length.

Do not compress away a consequential constraint merely to hit a word target.
Clarity wins when extra detail is genuinely task-specific.

During revision, keep IDs for semantically unchanged work. Allocate every new
ID above the highest numeric suffix ever present in the current file; do not
renumber after removal or reordering.

Keep completed tasks unless the user explicitly approves a documented change.
If revised scope invalidates completed work, explain the effect and update both
files consistently.

Avoid catch-all tasks such as "finish implementation" or "test everything."
A fresh implementer should know what delivered outcome permits each checkbox to
change without receiving a duplicate copy of the full plan.

## Review before persistence

Show the proposed title, slug, plan content, and task list before writing.

Call out assumptions, exclusions, and unresolved decisions that materially
affect review. Do not add a second prose walkthrough that repeats the proposed
files.

Treat edits requested during review as part of the proposal and ask for
confirmation of the final version. Confirmation authorizes only creation or
revision of the two planning files, not product implementation.

After confirmed creation, populate only stubs produced by `planlet create`,
because the CLI accepts no plan or task body content. After confirmed revision,
re-read current files immediately before editing and reconcile both documents in
one reviewable change.

In either case, targeted CLI validation and full post-write inspection must
succeed before reporting a valid handoff.

## Handle failures

Treat CLI exit status and structured error code as authoritative. Do not depend
on field order, whitespace, or incidental TOON formatting.

Stop on unsafe path, invalid slug, collision, write conflict, or invalid-plan
errors; report code and suggested next action without bypassing CLI.

Warnings require review but do not automatically invalidate a structurally
valid planlet.
```

---

## 3. `skills/planlet-plan/assets/plan-template.md`

Replace file with:

```markdown
# Plan Title

## Summary

Describe the intended outcome in a few sentences. State what will be true when
the work is complete without explaining the full implementation.

## Scope

List the important things that will change and the boundaries that prevent scope
drift. Include exclusions only when they are material.

## Approach

Explain the chosen implementation direction, important interfaces, and global
invariants or compatibility constraints. State each consequential design rule
once; do not duplicate the task list.

## Acceptance Criteria

- State an observable, verifiable finished outcome.
- State another material behavior, negative case, or compatibility expectation.

## Verification

Describe the broad automated and manual checks that establish success: stable
commands or check categories, expected outcomes, external gates, and known
limitations. Group related edge cases instead of duplicating detailed test
matrices in both this file and `tasks.md`.

Strategy only: routine check results stay in the test, review, and CI systems
that already hold them, never in this file or `tasks.md`.

## Risks and Considerations

Include this section only for material compatibility, migration, security, or
delivery risks. Remove it when no such risk needs explicit treatment.
```

---

## 4. `skills/planlet-plan/assets/tasks-template.md`

Replace file with:

```markdown
# Tasks: Plan Title

- [ ] T1 Deliver first implementation outcome in the relevant component.
- [ ] T2 Integrate the next outcome. Verify: run the targeted check that proves it.
- [ ] T3 Run the broader completion verification defined in `plan.md`.
```

The template is intentionally terse. `tasks.md` should read like an execution
index, not a second copy of `plan.md`.

---

## Optional companion change

I would also make one small change to
`skills/planlet-implement/SKILL.md`, even though it is outside the four planning
files above.

After Start workflow step 5, add:

```markdown
Treat `plan.md` as the authoritative change-specific design and acceptance
contract for this planlet and `tasks.md` as its execution index. A concise task
inherits every applicable scope, approach, acceptance, and verification
requirement from `plan.md`; absence of repeated detail in the task does not make
that requirement optional. Applicable repository instructions and higher-level
design contracts still take precedence when they explicitly constrain the plan.
```

This closes the loop. Planning skill can safely produce concise tasks because
implementation skill explicitly knows not to interpret them in isolation.
````

## Acceptance Criteria

- The skill files match the draft, with the declined-confirmation sentence on
  one line.
- `planlet --root . tools` reports every destination installed; the CI
  skill-drift step passes.
- Every verification command exits 0, with `npm test` permitted to reproduce
  exactly the two known `package-artifact.test.ts` failures under npm 12.0.2
  and nothing else.
- After all tasks are checked, `planlet --root . validate
  concise-planning-contract` succeeds and its single entry reports
  `summary.state: ready_to_complete`, read from the existing
  `entries[].summary.state` output contract: no new top-level state, no
  separate `status` command, and no CLI changes.

## Verification

Run the full suite: `npm run format:check`, `npm run lint`, `npm run knip`,
`npm run type-check`, `npm run build`, `npm test`, `git diff --check`.
Regenerate copies with `node dist/planlet.mjs update` and re-run
`planlet tools` after the edits. Prettier does not cover `skills/`, so no
formatting gate applies to the replaced files. Every verification command
must exit 0, except `npm test`, which may reproduce exactly the two known
`package-artifact.test.ts` failures under npm 12.0.2, as constrained in
Acceptance Criteria.

After all tasks are checked, run `planlet --root . validate
concise-planning-contract` and inspect the existing output contract: exactly
one entry, and `entries[0].summary.state` equal to `ready_to_complete`. The
plan adds no new CLI surface and requires no `status` command, because
`validate` already reports the lifecycle state per entry.

## Risks and Considerations

Skill-contract tests assert scenario evidence phrases as raw substrings of the
skill corpus; the draft's step 6 line wrap is the one known breakage,
corrected per Approach. Future edits to these sections must keep the pinned
phrases intact.

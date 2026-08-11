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

# Planning Guidance

## Investigate efficiently

Read repository instructions, relevant source and tests, package or build metadata, and nearby plans before recommending work. Trace the current behavior far enough to identify integration boundaries and verification surfaces. Do not edit product files during this workflow.

Look up repository facts instead of asking.
For a vague or incomplete request, surface material open decisions that affect outcome, boundaries, constraints, acceptance, verification, or task sizing.
Ask in small related batches and prefer about 2–4 related decisions per discovery batch.
Ask one-at-a-time only when answers depend on each other.
Include a recommended answer with each decision.
Narrow into a concrete proposal only after those decisions are settled enough for a fresh agent handoff.
If the request is already precise, proceed without ceremonial questions.

## Shape a focused plan

A useful `plan.md` lets a capable agent continue in a fresh session with enough outcome, boundaries, acceptance, and verification detail for an independent handoff. Normally include Summary, Scope, Approach, Acceptance Criteria, and Verification. Add Motivation, Out of Scope, or Risks and Considerations only when they remove ambiguity or prevent scope drift.

Keep implementation details at the level needed for a reliable handoff. Name important components, interfaces, migrations, compatibility constraints, and test boundaries, but do not duplicate the task list or prescribe incidental edits discovered only during implementation.

Acceptance criteria describe observable outcomes. Prefer statements that a reviewer or check can prove. Include negative behavior and compatibility expectations when they matter.

`Verification` is strategy, not a run log. Name the stable repository commands or check categories, their expected outcomes, when they run, external gates a reviewer must see, and known limitations. Do not record execution results in `plan.md` and never paste logs. A later strategy or scope change is a plan revision, not an execution journal entry.

Committed verification evidence is exceptional and absent by default. Tests, lint, type-checking, builds, ordinary pull-request review, and branch-protected CI already hold their own results, so a plan must not ask an implementer to copy them into `tasks.md`. Expect a `## Verification Evidence` note only when the plan foresees a durable fact that ordinary Git, test, pull-request, or CI history cannot reconstruct adequately: external, irreversible, non-reproducible, failed, partial, or unavailable verification whose residual result affects a later decision. Say so explicitly in `Verification` when the plan expects one, and stay silent otherwise.

## Build stable tasks

Map the chosen approach and acceptance criteria to an ordered checklist of verifiable outcomes:

- Make each task independently understandable and small enough to verify. A small task is one delivered outcome a typical agent can implement and verify without guessing scope.
- Describe a delivered result, not an agent thought process.
- Separate meaningful verification into explicit tasks when it spans several changes or gates completion.
- Order prerequisites before their consumers while avoiding dependency notation.
- Use unique IDs beginning with `T1` for a new planlet.
- During revision, keep IDs for semantically unchanged work. Allocate every new ID above the highest numeric suffix ever present in the current file; do not renumber after removal or reordering.
- Keep completed tasks unless the user explicitly approves a documented change. If revised scope invalidates completed work, explain the effect and update both files consistently.

Avoid catch-all tasks such as "finish implementation" or "test everything." A fresh implementer should know what evidence permits each checkbox to change.

## Review before persistence

Show the proposed title, slug, plan content, and task list before writing. Call out assumptions, exclusions, and unresolved decisions. Treat edits requested during review as part of the proposal and ask for confirmation of the final version. Confirmation authorizes only creation or revision of the two planning files, not product implementation.

After confirmed creation, populate only stubs produced by `planlet create`, because the CLI accepts no plan or task body content. After confirmed revision, re-read current files immediately before editing and reconcile both documents in one reviewable change. In either case, targeted CLI validation and full post-write inspection must succeed before reporting a valid handoff.

## Handle failures

Treat CLI exit status and structured error code as authoritative. Do not depend on field order, whitespace, or incidental TOON formatting. Stop on unsafe path, invalid slug, collision, write conflict, or invalid-plan errors; report code and suggested next action without bypassing CLI. Warnings require review but do not automatically invalidate a structurally valid planlet.

---
name: planlet-plan
description: Explore, propose, create, or revise one repository-local Planlet without implementing product changes. Use when a user wants to investigate and persist a focused plan, refine an existing planlet, or prepare a reviewable implementation handoff.
---

# Planlet Plan

Create or revise one focused planlet while keeping planning separate from implementation.

## Start the workflow

1. Discover the repository root without traversing above its boundary.
2. Determine whether the required `planlet` create and validate operations are available. Prefer those operations whenever they exist; do not duplicate their deterministic work.
3. If they are unavailable, announce that the narrow repository-local fallback is active and that CLI creation and validation checks cannot run.
4. Read `planlet_design.md` and applicable repository instructions when present. For a revision, resolve exactly one active planlet and re-read both `plan.md` and `tasks.md` from disk.

## Develop the proposal

1. Inspect the repository before recommending an approach.
2. Clarify only uncertainties that materially affect scope, design, acceptance, or verification. If the request is already precise, proceed without ceremonial questions.
3. Define the outcome, scope, exclusions, approach, acceptance criteria, verification, and meaningful risks. Compare options only when the choice matters.
4. Propose a descriptive slug matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` and verify that its logical slug is unused among active and completed planlets.
5. Turn the proposal into `plan.md` and a stable, verifiable task sequence in `tasks.md`. Read [planning guidance](references/planning-guidance.md) and use the templates in [plan-template.md](assets/plan-template.md) and [tasks-template.md](assets/tasks-template.md).
6. Present the proposed plan and tasks in conversation. Obtain explicit confirmation before writing either file. If confirmation is declined or absent, leave the repository unchanged.

## Persist or revise

When the CLI supports creation and validation, delegate those operations to it and inspect the result. Otherwise:

1. Resolve all paths beneath the repository root. Refuse an invalid slug, unsafe path, existing active directory, completed logical-slug conflict, or overwrite.
2. Create exactly `plans/<slug>/plan.md` and `plans/<slug>/tasks.md` only after confirmation.
3. Require each file to start with an H1. Recognize tasks only from top-level lines shaped as `- [ ] T<number> Description` or `- [x] T<number> Description`; require unique IDs.
4. For revisions, preserve IDs for unchanged tasks, assign new IDs above the highest numeric suffix, and reconcile both files. Never silently remove completed work; explain any completed task that becomes invalid or superseded.
5. Re-read both written files and perform the available structural checks.

Do not modify product code, create extra planning documents by default, or begin implementation unless the user separately requests it.

## Finish

Report the selected logical slug, paths written or revised, proposal status, validation performed, and any warnings or unresolved decisions. When fallback was used, repeat that deterministic CLI creation or validation was unavailable.

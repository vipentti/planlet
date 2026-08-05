---
name: planlet-plan
description: Explore, propose, create, or revise one repository-local Planlet without implementing product changes. Use when a user wants to investigate and persist a focused plan, refine an existing planlet, or prepare a reviewable implementation handoff.
allowed-tools: Bash(planlet:*)
compatibility: Requires planlet CLI.
license: MIT
---

# Planlet Plan

Create or revise one focused planlet while keeping planning separate from implementation.

## Start the workflow

1. Discover the repository root without traversing above its boundary.
2. Use one available `planlet` executable throughout the workflow. Confirm each needed operation with `planlet help <command>`; do not infer support from this skill. Pass `--root "<repository-root>"` to every operational command. Treat angle-bracket runtime values as separate argv values; when invoking through a shell, apply shell-specific escaping instead of interpolating raw text.
3. Use `planlet --root "<repository-root>" list` to inspect active logical slugs and `planlet --root "<repository-root>" list --completed` to inspect completed logical slugs. For a revision, resolve exactly one active slug, run `planlet --root "<repository-root>" validate <slug>`, and read both files completely with `planlet --root "<repository-root>" --full show <slug> --part plan` and `planlet --root "<repository-root>" --full show <slug> --part tasks`.
4. Read applicable repository instructions when present.
5. The `planlet` CLI is required. If no executable is available, install it
   (`npm install -g @vipentti/planlet`) or invoke it through `npx @vipentti/planlet`. If it still
   cannot run, stop and report that, naming the missing executable. Do not reimplement CLI
   operations by editing planlet files.

## Develop the proposal

1. Inspect the repository before recommending an approach.
2. Look up repository facts instead of asking.
   - For a vague or incomplete request, surface material open decisions that affect outcome, boundaries, constraints, acceptance, verification, or task sizing.
   - Ask in small related batches (prefer about 2–4 related decisions; one-at-a-time only when answers depend on each other) with a recommended answer for each decision.
   - Settle those decisions enough for a fresh-session handoff before narrowing into a concrete proposal.
   - If the request is already precise, proceed without ceremonial questions.
3. Define the outcome, scope, exclusions, approach, acceptance criteria, verification, and meaningful risks. Compare options only when the choice matters. Keep `plan.md` static: verification records strategy, never results of a past or future run.
4. Propose a descriptive slug matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` and verify that its logical slug is unused among active and completed planlets.
5. Turn the proposal into `plan.md` and a stable, verifiable task sequence in `tasks.md`. Keep each task small enough that a typical agent can implement and verify it independently. Read [planning guidance](references/planning-guidance.md) and use the templates in [plan-template.md](assets/plan-template.md) and [tasks-template.md](assets/tasks-template.md).
6. Present the proposed plan and tasks in conversation. Obtain explicit confirmation before writing either file. If confirmation is declined or absent, leave the repository unchanged.

## Persist or revise

For a new confirmed planlet:

1. Run `planlet --root "<repository-root>" create <slug> --title "<title>"`. Treat non-zero exit as no authorization to write around a slug, path, or collision failure.
2. Confirm CLI created only H1 stubs. When the harness exposes a dedicated file-reading capability, read each created file with it rather than through a shell command, because such a harness can reject a write to a file it has not read and may not count a shell read. Then replace those two stubs with approved `plan.md` and `tasks.md` content, because `create` writes H1 stubs only and no CLI command accepts plan or task body content. Never use `create` for revision or overwrite an existing planlet.
3. Run `planlet --root "<repository-root>" validate <slug>`, then re-read both files with `planlet --root "<repository-root>" --full show <slug> --part plan` and `planlet --root "<repository-root>" --full show <slug> --part tasks`; inspect exact persisted content.

For a confirmed revision, edit both existing files directly because CLI has no semantic revision operation. When the harness exposes a dedicated file-reading capability, read each file with it before editing, because such a harness can reject an edit to a file it has not read and may not count a shell read. Preserve IDs for unchanged tasks, assign new IDs above highest numeric suffix, and never silently remove completed work. Then run targeted `validate` and full `show` inspection as above.

Do not modify product code, create extra planning documents by default, or begin implementation unless the user separately requests it.

## Finish

Report selected logical slug, paths written or revised, proposal status, exact CLI validation result, warnings, and unresolved decisions.

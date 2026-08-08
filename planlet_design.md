# Planlet Design

> **Status:** Initial product and technical design
>
> **Purpose:** Provide durable context for designing and implementing the Planlet CLI and its agent skills.

## 1. Summary

Planlet is a lightweight, repository-local planning and task-management utility designed primarily for AI coding agents and secondarily for human review.

It supports a simple lifecycle:

```text
explore and plan -> human review -> implement -> verify -> complete/archive
```

Every unit of work is a **planlet**: a small, self-contained, reviewable implementation plan consisting of exactly two primary Markdown files:

```text
plans/<descriptive-name-slug>/
├── plan.md
└── tasks.md
```

Completed planlets are moved to:

```text
plans/completed/<YYYY-MM-DD>-<descriptive-name-slug>/
```

Planlet deliberately provides less documentation ceremony than specification-driven systems such as OpenSpec. It does not require separate proposal, requirements, design, or specification documents. The intended product boundary is:

- Agent skills provide reasoning, investigation, conversation, implementation, and judgment.
- The CLI provides deterministic naming, discovery, validation, progress updates, status calculation, installation, and archival operations.
- Markdown files remain the transparent, version-controlled source of truth.

## 2. Name and Vocabulary

**Project name:** Planlet  
**CLI executable:** `planlet`  
**Tagline:** _Small plans. Clear handoffs._

A **planlet** is a small, executable, reviewable unit of intended work. The name communicates the core distinction from heavier specification systems: Planlet manages focused plans rather than a permanent specification corpus or full project roadmap.

Canonical skill names:

- `planlet-plan`
- `planlet-implement`
- `planlet-complete`

Possible user-facing invocations depend on the agent harness:

```text
$planlet-plan Add support for multiple users
$planlet-implement add-more-users
$planlet-complete add-more-users
```

Some harnesses may expose these as slash commands, namespaced commands, or skills selected through natural language. The underlying skill behavior must remain the same.

Use **complete** as the canonical lifecycle term. **Archive** describes the storage operation and may be retained as a CLI or skill alias for discoverability.

## 3. Problem Statement

AI coding sessions often contain important planning context that is lost when the conversation ends. Existing spec-driven workflows solve this but may introduce more documents, phases, and long-lived specification management than a small project or personal workflow needs.

Planlet should make it inexpensive to:

- Investigate an idea before changing code.
- Agree on a concrete implementation plan.
- Persist only the context needed by a future implementing agent.
- Track progress reliably across sessions.
- Let humans review and edit plans using ordinary Markdown and Git.
- Support several active plans without confusing which one is being implemented.
- Prevent accidental archival of unfinished work.
- Work across multiple agent harnesses rather than being tied to one vendor.

## 4. Goals

### 4.1 Primary goals

- Keep planning artifacts small, obvious, and human-readable.
- Store all project state locally in the repository.
- Make a plan portable between users, sessions, agents, and CI systems.
- Separate generative agent behavior from deterministic file and lifecycle operations.
- Support many active planlets while targeting exactly one planlet per implementation or completion operation.
- Make status and task progress cheap for agents to query.
- Produce compact, structured, token-efficient CLI output.
- Make incomplete completion attempts safe and explicit.
- Support Agent Skills-compatible harnesses through generated or copied installation artifacts.
- Work well for code changes while remaining general enough for other repository-local work.

### 4.2 Secondary goals

- Support automated implementation in CI or background-agent environments.
- Make it easy for a later integration to create a pull request after successful implementation.
- Allow optional native standalone executables in the future.
- Allow additional workflow skills or harness adapters without changing the plan format.

## 5. Non-goals

The initial product is not intended to be:

- A permanent desired-state specification system.
- A replacement for GitHub Issues, Jira, Linear, or project roadmaps.
- A database-backed task service.
- A multi-user real-time collaboration server.
- A general Markdown editor or parser.
- A dependency-graph scheduler or multi-agent orchestrator.
- An agent runtime or model provider.
- A tool that creates pull requests by itself in the MVP.
- A tool that semantically decides whether an implementation is correct without an agent.

These boundaries should remain explicit. Planlet may integrate with larger systems later without absorbing their responsibilities.

## 6. Design Principles

1. **Two primary files per planlet.** Keep `plan.md` and `tasks.md` sufficient for the normal workflow.
2. **Files are the source of truth.** Avoid hidden databases and opaque state.
3. **Skills reason; the CLI calculates.** Put judgment in skills and deterministic mechanics in code.
4. **Review before implementation.** A user should be able to inspect and revise the persisted plan before work begins.
5. **No silent completion.** Always verify task completion before archival.
6. **One target per mutating operation.** Implementation and completion must never implicitly operate on several planlets.
7. **Many active plans are normal.** Listing and status commands must handle this efficiently.
8. **Agent-efficient by default.** Minimize output fields and round trips.
9. **Human-readable without special tools.** The repository remains understandable if the CLI is unavailable.
10. **Portable skills, thin adapters.** Maintain one canonical workflow and render only harness-specific packaging.
11. **Safe, non-destructive lifecycle operations.** Completion moves files; it does not delete them.
12. **Low ceremony over exhaustive documentation.** Add structure only when it improves implementation reliability.

## 7. High-Level Architecture

```text
User or automation
        |
        v
Agent harness (Codex, Claude Code, generic Agent Skills, ...)
        |
        v
Planlet skill (plan / implement / complete)
        |                        \
        | judgment               \ deterministic operations
        v                         v
Repository analysis          Planlet CLI
                                  |
                                  v
                      plans/<slug>/{plan.md,tasks.md}
```

The skill is responsible for activities such as reading code, comparing technical options, asking clarifying questions, deciding what tests are appropriate, and implementing changes.

The CLI is responsible for activities such as validating slugs, locating the repository root, creating folders, parsing task checkboxes, calculating progress, producing structured output, installing skills, and moving completed plans.

The CLI must not call an LLM. Skills must not duplicate deterministic parsing and lifecycle rules when the CLI is available.

## 8. User Workflows

### 8.1 Plan

Example request:

```text
$planlet-plan Let's implement a feature that adds more users to the system.
```

The Plan skill should:

1. Accept the user's description, or ask what they want to plan when no useful description is provided.
2. Inspect the repository before recommending an approach.
3. Clarify the problem, desired outcome, boundaries, constraints, and acceptance criteria.
4. Compare reasonable approaches when the choice is not obvious.
5. Call out risks, migrations, compatibility concerns, and testing needs.
6. Narrow the discussion into a concrete, buildable scope.
7. Propose a descriptive kebab-case slug.
8. Present a concise plan and task breakdown in the conversation.
9. Ask the user to confirm before writing the planlet to the repository.
10. After confirmation, use `planlet create` to scaffold both `plan.md` and `tasks.md`, then replace the stubs with the agreed plan and task content.
11. Validate the populated planlet and report its path and status.

Planning is conversational and may be abandoned without creating files. Unlike OpenSpec's separate Explore and Propose commands, Planlet intentionally combines exploration and proposal into one skill while retaining a confirmation boundary before persistence.

If the user already knows exactly what they want, the skill should avoid unnecessary questions and proceed directly to repository analysis and a proposed written plan.

### 8.2 Human review and revision

After creation, the user may:

- Read or edit `plan.md` and `tasks.md` directly.
- Ask an agent to revise the plan.
- Commit the plan without implementing it.
- Hand it to a different agent or future session.
- Start implementation immediately.

When a revision changes scope, approach, acceptance criteria, or deliverables, the Plan skill must reconcile both files. It must not update `plan.md` while leaving a stale task list.

Revision rules:

- Preserve stable IDs of unchanged tasks.
- Do not silently remove completed tasks.
- Explain when a plan change invalidates or supersedes completed work.
- Add, remove, split, or reorder unfinished tasks to match the revised plan.
- Re-run structural validation after editing.

The CLI can validate structure, but semantic consistency between the two documents remains an agent responsibility.

### 8.3 Implement

Example request:

```text
$planlet-implement add-more-users
```

The Implement skill should:

1. Accept exactly one slug, or resolve which active planlet the user means.
2. Read both `plan.md` and `tasks.md` completely.
3. Validate the planlet before changing code.
4. Inspect the current repository because the code may have changed since planning.
5. Compare current conditions with the plan and raise material conflicts.
6. Implement tasks in a sensible order, respecting dependencies described by the checklist.
7. Mark a task complete only after its work and relevant verification succeed.
8. Keep `tasks.md` current throughout implementation, not only at the end.
9. Run tests and other checks in proportion to the change.
10. Report failures, blockers, deviations, and newly discovered work clearly.
11. Avoid silently expanding scope. Material additions should be reflected in the plan and task list or approved by the user.
12. Finish with a summary of changes, verification results, and any remaining tasks.

Starting implementation is considered approval to execute that specific persisted planlet. A separate `approved` metadata field is not required in the MVP.

### 8.4 Complete and archive

Example request:

```text
$planlet-complete add-more-users
```

The Complete skill should:

1. Resolve exactly one active planlet.
2. Run structural validation.
3. Ask the CLI to verify task completion.
4. If all tasks are complete, summarize the result and complete the planlet.
5. If tasks remain incomplete, show the remaining task IDs and descriptions.
6. Warn the user that the planlet is incomplete and ask for explicit confirmation before overriding the check.
7. If confirmed, provide an explicit reason to the CLI and archive with the incomplete-task override.
8. Capture one UTC completion timestamp and derive the `YYYY-MM-DD` archive date from it.
9. Move the planlet to `plans/completed/<YYYY-MM-DD>-<slug>`.
10. Report the logical slug, final destination, and whether completion was normal or forced.

The CLI itself should remain non-interactive. On incomplete work it returns a structured error and non-zero exit code. The skill owns the human confirmation conversation and then, if approved, calls an explicit override such as:

```bash
planlet complete add-more-users \
  --allow-incomplete \
  --reason "Two deployment tasks were intentionally deferred"
```

The completion operation should record the full UTC timestamp and completion mode in `tasks.md` before moving the directory. An incomplete override should additionally record the remaining task IDs and override reason. The archive date and recorded timestamp must come from the same captured instant. This preserves the two-file model while leaving an audit trail.

### 8.5 CI and pull-request workflow

A future automated workflow may:

1. Select one active planlet explicitly.
2. Run the Implement skill in a non-interactive agent session.
3. Verify that all tasks and tests pass.
4. Commit the implementation and updated task list.
5. Create a pull request through a separate integration.
6. Allow a human or follow-up job to run the Complete skill after approval or merge.

Planlet should expose clean exit codes and machine output to enable this, but should not couple the core CLI to a particular CI or Git hosting service.

## 9. Repository Layout

Default layout:

```text
<repository-root>/
├── plans/
│   ├── add-more-users/
│   │   ├── plan.md
│   │   └── tasks.md
│   ├── improve-search-ranking/
│   │   ├── plan.md
│   │   └── tasks.md
│   └── completed/
│       └── 2026-07-22-previous-change/
│           ├── plan.md
│           └── tasks.md
└── ...
```

Defaults:

- Active root: `plans/`
- Completed root: `plans/completed/`
- Completed archive name: `<YYYY-MM-DD>-<slug>`
- Plan filename: `plan.md`
- Task filename: `tasks.md`

The MVP should prefer convention over configuration. Custom paths can be considered later, but the CLI should support an explicit `--root <path>` for automation and unusual repository layouts.

### 9.1 Repository-root discovery

Suggested behavior:

1. Use `--root` when supplied.
2. Otherwise walk upward from the current directory until a repository marker such as `.git` is found.
3. If no repository marker is found, use the current directory only when it already contains `plans/` or when the command explicitly creates a new setup.
4. Never walk above the discovered root when resolving plan paths.

The MVP supports exactly one `plans/` directory per repository, located at the discovered root. Multi-package monorepos that want isolated planlet sets are out of scope for the MVP; `--root` can be pointed at a package subdirectory as a manual workaround, but repository-root discovery does not search for or aggregate multiple `plans/` directories automatically.

## 10. Planlet File Contract

### 10.1 Slug rules

A slug should:

- Use lowercase ASCII letters, digits, and single hyphens.
- Begin and end with an alphanumeric character.
- Be descriptive rather than numbered-only.
- Reject path separators, `.` segments, whitespace, underscores, and repeated hyphens.
- Be unique among both active and completed planlets unless an explicit reopen or rename workflow is added later. The date prefix on a completed archive does not change or replace this logical slug.

Example valid slug:

```text
add-multiple-user-support
```

Example validation expression:

```text
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

### 10.2 Completed archive names

Completion changes a planlet's storage name without changing its logical slug. A completed archive name must:

- Use `<YYYY-MM-DD>-<slug>`.
- Derive `YYYY-MM-DD` from the UTC calendar date of the full completion timestamp recorded in `tasks.md`.
- Contain a real calendar date followed by the unchanged logical slug.
- Be treated as a storage name, not as the planlet's slug or a new identifier.

For example, completing `add-multiple-user-support` at `2026-07-22T23:59:59Z` produces:

```text
plans/completed/2026-07-22-add-multiple-user-support/
```

Completed-plan discovery should parse and validate the date prefix, then expose the original slug separately from the archive name and path. A date-prefixed archive does not permit another active or completed planlet with the same logical slug. Completion must refuse both logical-slug conflicts and an existing destination archive.

### 10.3 `plan.md`

`plan.md` contains intent and implementation context. It should be detailed enough for a capable agent in a fresh session, without duplicating the task checklist.

Recommended template:

```markdown
# Add Multiple User Support

## Summary

Briefly describe the intended outcome.

## Motivation

Explain the problem and why it is worth solving.

## Scope

Describe what will change.

## Out of Scope

List nearby work that is intentionally excluded.

## Approach

Describe the chosen technical approach and important decisions.

## Acceptance Criteria

- Observable outcome one.
- Observable outcome two.

## Verification

Describe the relevant automated and manual checks as strategy only (see §10.4).

## Risks and Considerations

Record migrations, compatibility concerns, security implications, or open risks.
```

Sections can be omitted when they would add no value, but Summary, Scope, Approach, Acceptance Criteria, and Verification should normally be present.

The CLI should treat most of `plan.md` as opaque Markdown. It may extract the first H1 as the display title and validate the presence of expected headings, but it should not attempt semantic interpretation.

This template describes the plan's eventual, populated content once an agent or human has filled it in; it is not what `planlet create` writes. `create` always scaffolds the minimal H1-only stub defined by §10.5, regardless of how much of this template the finished plan will use.

### 10.4 `tasks.md`

`tasks.md` is the machine-readable progress surface and human checklist.

Recommended template:

```markdown
# Tasks: Add Multiple User Support

- [ ] T1 Add the user persistence model and migration
- [ ] T2 Implement user creation and retrieval services
- [ ] T3 Expose the required API operations
- [ ] T4 Add unit and integration tests
- [ ] T5 Run the relevant verification suite
```

Rules:

- A task line uses `- [ ]` or `- [x]`.
- Each task has a stable, unique ID such as `T1`.
- Matching of `[x]` may be case-insensitive on read but should normalize to lowercase on write.
- IDs must not be renumbered simply because tasks are reordered.
- New task IDs are assigned as the highest existing numeric suffix plus one, not a count of current tasks, so IDs remain stable and collision-free after tasks are removed or reordered.
- Task text should describe a verifiable outcome, not an agent thought process.
- Verification should appear as explicit tasks when it is significant.
- The MVP need not support nested task trees or dependency syntax.
- Free-form Markdown notes are allowed outside recognized task lines.

Verification records are divided as follows, without any new file, command, or schema:

- `plan.md` `Verification` is the static strategy: stable commands or check categories, expected outcomes, external gates, and known limitations.
- Task checkboxes are the progress gate. A failed, partial, or unavailable check leaves its task unchecked.
- An optional `## Verification Evidence` section in `tasks.md` is exceptional and absent by default. It exists only for a durable fact that ordinary Git, test, pull-request, or CI history cannot reconstruct adequately: external, irreversible, non-reproducible, failed, partial, or unavailable verification whose residual result affects a later decision. Routine tests, lint, type-checking, builds, review, and branch-protected CI stay in the systems that already hold them.
- The CLI-generated `## Completion` record is a lifecycle audit only, and never carries verification results.

The evidence section is free-form Markdown that the CLI treats as opaque, and it never gates completion. Whatever it records must be effectively write-once: no current-head or self-referential commit SHA, moving branch, `latest`, or dashboard link, bare run identifier, transient log, or local path — nothing that needs editing as later commits land. Prefer a final artifact version or digest, or a stable external record, and only when material; a provider record that already binds to its source needs no duplicate SHA. Because the parser reads every top-level `- [ ]` or `- [x]` bullet as a task line, evidence lines must be plain bullets or prose; a checkbox-shaped evidence line is rejected as a malformed or duplicate task.

A completion record must be appended by the CLI before moving the planlet:

```markdown
## Completion

- Completed at: 2026-07-22T12:34:56Z
- Mode: normal
```

For an incomplete override, `Mode` should be `incomplete override`, followed by the remaining task IDs and the user-approved reason.

The task parser should be deliberately narrow and line-oriented. A general Markdown AST dependency is not necessary for the MVP.

### 10.5 Creation scaffolding

`planlet create <slug> [--title <title>]` creates a minimal, structurally valid draft for an agent or human to populate. It must create exactly these two primary files:

`plan.md`:

```markdown
# Add Multiple User Support
```

`tasks.md`:

```markdown
# Tasks: Add Multiple User Support
```

When `--title` is supplied, trim surrounding whitespace, require non-empty single-line text, and use it for both H1 headings. Otherwise, derive the display title by splitting the slug at hyphens, uppercasing the first ASCII letter of each segment, leaving the remaining characters unchanged, and joining the segments with spaces. The CLI must not add instructional prose, placeholder tasks, or semantic plan content.

The directory and both files should become visible as one safe creation operation, for example by preparing them in a temporary sibling directory and renaming it into place after both writes succeed. Creation must refuse active or completed logical-slug conflicts and must not leave a partially created planlet on failure.

A newly created scaffold has zero recognized tasks and therefore derives the `draft` state. It is structurally valid, although normal advisory warnings such as missing recommended `plan.md` sections may remain until an agent or human populates it.

## 11. Derived Lifecycle States

Avoid mandatory status frontmatter in the MVP. Status can be calculated from file location and task progress:

| Condition                                                            | Derived state       |
| -------------------------------------------------------------------- | ------------------- |
| Required files missing or malformed                                  | `invalid`           |
| Valid files but zero recognized tasks                                | `draft`             |
| Tasks exist and none are checked                                     | `planned`           |
| Some but not all tasks are checked                                   | `in_progress`       |
| All tasks are checked in an active directory                         | `ready_to_complete` |
| Planlet is under a valid date-prefixed archive in `plans/completed/` | `completed`         |

Completed planlets should still be structurally inspectable. A completed planlet with unchecked tasks and no override record should produce a hygiene warning.

## 12. Target Selection and Concurrency

Several active planlets may exist simultaneously, but every mutating workflow must target exactly one.

Selection rules when a skill receives no slug:

1. If there are no active planlets, report that clearly.
2. If exactly one active planlet exists, the skill may propose or select it and state the selection.
3. If several active planlets exist, ask the user which one to use.
4. Never choose the newest or first planlet silently when several are available.

The CLI should require a slug for mutating commands. It may provide a read-only `resolve` or `list` command that helps a skill perform the selection logic.

“One at a time” means one target per invocation or agent workflow. The MVP does not need a global active-plan pointer.

Task-file writes should be atomic. Mutating CLI operations that rewrite `tasks.md` (`task check`, `task uncheck`, and `complete`) take an exclusive per-planlet lock. Locks live outside the repository, in a per-owner, per-repository-root directory under the OS temp directory, so a transient holder file never appears in `git status` or an editor tree. Each acquisition writes an ownership token into the holder file and returns that token with the lock path. Competing writers fail with `write_conflict` rather than applying a stale read-modify-write. Stale locks are not reclaimed automatically: remove-then-create admits two writers when both observe the same dead holder, and no file-based compare-and-delete closes that window. Confirmed manual removal is the recovery path until `flock(2)`/`LockFileEx` is bound. Release renames the holder aside and deletes only when the quarantined ownership token still matches, so a late release cannot unlink a successor's lock. Live holders are never stolen. Editors and git can still rewrite `tasks.md` outside the CLI lock; treat that as ordinary version-control conflict resolution.

## 13. CLI Design

### 13.1 Intended audience

The primary CLI consumer is an AI agent. Humans can also use it, especially for inspection and setup.

The CLI should follow agent-ergonomic principles:

- Compact default output.
- Minimal fields for list results.
- Precomputed progress totals and status.
- Explicit empty states.
- Structured errors and stable exit codes.
- No interactive prompts in operational commands. `planlet init` is the sole exception permitted by section 15.3: it asks which harness destinations to install only when `--tools` is absent and both stdin and stdout are TTYs, so agent and CI invocations never see a prompt and `--tools` remains the full non-interactive equivalent.
- Idempotent operations where practical.
- Clear next-action hints without verbose prose.
- A concise, consistent help surface.
- Content-first behavior when invoked without arguments.

### 13.2 Proposed commands

Setup and skill installation:

```text
planlet init [--tools <ids>]
planlet update [--tools <ids>]
planlet tools
```

Plan management:

```text
planlet
planlet list [--state <state>] [--completed]
planlet create <slug> [--title <title>]
planlet show <slug> [--part plan|tasks|summary]
planlet status <slug>
planlet validate [<slug>|--all]
```

Task management:

```text
planlet tasks <slug> [--remaining|--completed]
planlet task check <slug> <task-id>
planlet task uncheck <slug> <task-id>
```

Lifecycle management:

```text
planlet complete <slug> [--allow-incomplete --reason <text>]
planlet archive <slug> [same options]     # optional alias
```

Possible future commands:

```text
planlet rename <old-slug> <new-slug>
planlet reopen <slug>
planlet doctor
planlet config
planlet completions <shell>
```

### 13.3 No-argument behavior

Running `planlet` with no arguments should display a compact active-plan dashboard rather than the full help text. This follows the AXI content-first principle.

Example conceptual output:

```text
plans[2]{slug,state,done,total}:
  add-more-users,in_progress,3,5
  improve-search,planned,0,4
summary{active,ready,invalid}: 2,0,0
```

Use `planlet help` or `planlet <command> --help` for command reference.

### 13.4 Output formats

Proposed formats:

- Default: compact structured output for agents, serialized with the official TOON library (`@toon-format/toon`). Phase 1 ships this format only; see §21.
- `--json`: stable JSON for integrations and tests. Deferred beyond Phase 1.
- `--human`: readable tables and explanatory text. Deferred beyond Phase 1.
- `--quiet`: identifiers or minimal success output where appropriate. Deferred beyond Phase 1.
- `--full`: return the complete `show --part plan|tasks` content instead of the
  compact preview.

The default should be deterministic rather than changing automatically based on whether stdout is a terminal. Agents and scripts should not receive different schemas in different environments.

Output rules:

- Data goes to stdout.
- Diagnostics and warnings go to stderr.
- Do not use decorative banners or spinners when output is not explicitly human-oriented.
- List records should normally contain only slug, state, completed count, and total count.
- Mutating task commands (`task check`, `task uncheck`) return post-write
  `state`, `done`, `total`, and a conditional `next` hint (present only when
  the plan becomes `ready_to_complete`).
- Completed-plan output should keep the logical slug distinct from the archive name and path, and expose the recorded completion timestamp when the selected format requests completion details.
- Empty results must be explicit, for example `plans[0]` plus summary counts.
- Large `show --part plan|tasks` content should be truncated with a size hint;
  `--full` returns the complete content.
- `--json` output should include a `schemaVersion` integer field so downstream integrations can detect breaking output changes independently of the CLI's own version number.

### 13.5 Structured errors

Errors should include a stable code, concise message, relevant fields, and suggested next action.

Example incomplete completion error:

```text
error{code,message,slug,completed,total,remaining}:
  incomplete_tasks,"Planlet has incomplete tasks",add-more-users,3,5,"T4,T5"
next: planlet tasks add-more-users --remaining
```

Suggested error codes:

- `repo_not_found`
- `plans_not_initialized`
- `invalid_slug`
- `plan_not_found`
- `plan_already_exists`
- `completed_plan_exists`
- `invalid_plan`
- `task_not_found`
- `duplicate_task_id`
- `incomplete_tasks`
- `archive_collision`
- `unsafe_path`
- `unsupported_tool`
- `write_conflict`
- `internal_error`

Suggested exit-code categories:

- `0`: success
- `1`: general operational error
- `2`: usage or invalid arguments
- `3`: invalid planlet structure
- `4`: requested state transition is not allowed
- `5`: filesystem or write conflict

Exact codes should be documented and tested before the public CLI contract is considered stable.

## 14. Skills

All skills should follow the open Agent Skills structure, with `SKILL.md` as the canonical workflow definition and optional scripts, references, and assets:

```text
skills/
├── planlet-plan/
│   ├── SKILL.md
│   ├── references/
│   │   └── planning-guidance.md
│   └── assets/
│       ├── plan-template.md
│       └── tasks-template.md
├── planlet-implement/
│   ├── SKILL.md
│   └── references/
│       └── implementation-guidance.md
└── planlet-complete/
    ├── SKILL.md
    └── references/
        └── completion-guidance.md
```

The required `name` and `description` frontmatter should make each skill discoverable without loading its full instructions. Detailed material should use progressive disclosure so ordinary agent context remains small.

Skills also declare `allowed-tools: Bash(planlet:*)` so Claude Code
pre-approves literal `planlet` commands for the invoking turn;
`compatibility: Requires planlet CLI.` and `license: MIT` are standard optional
metadata.

### 14.1 `planlet-plan`

Responsibilities:

- Explore the user's request and repository.
- For vague or incomplete requests, surface material open decisions (outcome, boundaries, constraints, acceptance, verification, task sizing) in small related batches with a recommended answer; look up repository facts instead of asking.
- For precise requests, skip ceremonial questions and proceed to analysis and proposal.
- Compare options and recommend an approach.
- Define scope, exclusions, acceptance criteria, and the verification strategy, without recording run results.
- Propose the slug.
- Obtain confirmation before writing.
- After confirmation, scaffold new files with `planlet create` (per §8.1 step 10) rather than writing them directly, then replace the stubs with the agreed content; revise existing files consistently.
- Run CLI validation.

Must not:

- Modify product code during planning.
- Persist a plan before confirmation.
- Create extra documents by default.
- Leave `tasks.md` inconsistent with `plan.md`.

### 14.2 `planlet-implement`

Responsibilities:

- Select exactly one planlet.
- Read and validate it.
- Reinspect the current codebase.
- Implement tasks and verify outcomes.
- Check off tasks incrementally through the CLI.
- Surface plan drift and blockers.
- Record an exceptional, write-once `## Verification Evidence` note in `tasks.md` only when ordinary history cannot reconstruct a durable verification fact.
- Report completion readiness.

Must not:

- Implement several planlets in one invocation.
- Check a task merely because code was written; relevant verification must pass.
- archive the planlet automatically unless the user explicitly requested combined implementation and completion behavior.

### 14.3 `planlet-complete`

Responsibilities:

- Select exactly one planlet.
- Validate it and inspect remaining tasks.
- Complete normally when all tasks are checked.
- Warn and ask for confirmation when work remains.
- Supply an override reason only after explicit confirmation.
- Report the archived path and completion mode, plus whether an optional evidence section was present.

Must not:

- Parse, rerun, or create verification evidence; the completion record is a lifecycle audit.
- Bypass the CLI's completion check silently.
- treat missing or malformed task files as completed.
- complete several planlets at once in the core workflow.

## 15. Multi-Harness Support

Multi-harness support is a core architectural requirement. Planlet should not hard-code its skills around Claude Code, Codex, or any single product.

### 15.1 Canonical format

Maintain one canonical Agent Skills-compatible skill directory for each workflow. Harness installations should be generated or copied from these sources.

Do not maintain separate hand-written Claude, Codex, and generic versions of the workflow. Harness-specific command files should be thin launch adapters that point to the canonical skill behavior.

### 15.2 Initial harness registry

Suggested initial tool IDs and project-local skill destinations:

| Tool ID          | Harness              | Skill path pattern                  | Command adapter                             |
| ---------------- | -------------------- | ----------------------------------- | ------------------------------------------- |
| `agents`         | Generic Agent Skills | `.agents/skills/planlet-*/SKILL.md` | None                                        |
| `claude`         | Claude Code          | `.claude/skills/planlet-*/SKILL.md` | Optional `.claude/commands/planlet/<id>.md` |
| `codex`          | Codex                | `.agents/skills/planlet-*/SKILL.md` | None; skills-first                          |
| `github-copilot` | GitHub Copilot       | `.agents/skills/planlet-*/SKILL.md` | None; skills-first                          |

Codex discovers repository-local skills from `.agents/skills` between the current working directory and repository root. It does not require a separate `.codex/skills` copy. The `agents` and `codex` tool IDs therefore target the same project-local directory; the installer must coalesce them when both are requested. `.codex/` remains available for Codex-specific configuration, but is not a Planlet skill destination.

GitHub Copilot likewise reads `.agents/skills` (verified with Copilot CLI
1.0.78); `github-copilot` shares that destination with `agents` and `codex`
and must coalesce with them. Do not add a separate `.github/skills` copy: a
duplicate skill name there shadows the `.agents/skills` copy in Copilot's
listing.

Likely later additions, following the same data-driven registry pattern:

| Tool ID       | Skill path pattern                    |
| ------------- | ------------------------------------- |
| `cursor`      | `.cursor/skills/planlet-*/SKILL.md`   |
| `gemini`      | `.gemini/skills/planlet-*/SKILL.md`   |
| `opencode`    | `.opencode/skills/planlet-*/SKILL.md` |
| `antigravity` | `.agent/skills/planlet-*/SKILL.md`    |

These paths follow the general convention demonstrated by OpenSpec's multi-tool installer. Exact behavior should be covered by adapter tests because harness conventions can evolve.

### 15.3 Setup interface

Suggested commands:

```bash
# Install for specific harnesses
planlet init --tools claude,codex

# Install all currently supported adapters
planlet init --tools all

# Initialize only the plans directory
planlet init --tools none

# Refresh generated skills after upgrading Planlet
planlet update --tools claude,codex

# Detect supported harness directories without modifying them
planlet tools
```

The CLI should avoid interactive prompts in agent and CI use. If a future human-friendly wizard is added, every choice must have a non-interactive flag equivalent.

`planlet init` implements exactly that allowance. On an interactive terminal without `--tools` it asks which destinations to install, defaulting to those that already contain something, and `--tools` expresses every possible answer non-interactively.

### 15.4 Adapter architecture

Represent harness support as data plus small renderers:

```ts
interface HarnessAdapter {
  id: string;
  displayName: string;
  skillDirectory: string;
  supportsSkills: boolean;
  supportsCommands: boolean;
  commandDirectory?: string;
  renderCommand?: (skill: SkillDefinition) => string;
}
```

Installer behavior should:

1. Validate requested tool IDs.
2. Resolve destinations inside the repository root.
3. Coalesce tool IDs that resolve to the same destination, then copy or render each selected Planlet skill once.
4. Generate optional command adapters only for harnesses that support them.
5. Avoid symlinks by default for Windows and repository portability.
6. Mark generated files clearly.
7. Detect locally modified generated files before overwriting them.
8. Support deterministic `update` behavior.
9. Produce a compact installation summary.

The MVP may package the compiled CLI alongside each installed skill or have skills call the globally installed `planlet` executable. Bundling a synchronized, dependency-free `planlet.mjs` makes skills more self-contained, while a global executable simplifies updates. This choice should be tested through a small installation prototype before finalizing packaging.

### 15.5 Project-local and global installation

Project-local installation should be the initial default because it is reviewable, version-controlled, and reproducible for collaborators and CI.

Possible future scopes:

- `--scope project`: install under the repository's harness directories.
- `--scope user`: install under user-level harness skill directories.

User-level paths vary by harness and should not be added until their behavior and update semantics are well tested.

## 16. Technology Choice

### 16.1 Recommended implementation

Use TypeScript for development and distribute compiled JavaScript for Node.js.

Recommended baseline:

- TypeScript source.
- Node.js 22 or newer.
- Test on maintained Node 22 and Node 24 LTS environments initially.
- Bundle the CLI into one `dist/planlet.mjs` artifact.
- Publish an npm package with a `bin` entry for `planlet`.
- Use `#!/usr/bin/env node` in the executable bundle.
- Prefer Node built-ins and keep runtime dependencies minimal. The official TOON library (`@toon-format/toon`, see §13.4) is a deliberate exception, adopted as the default-output serializer instead of a hand-rolled implementation of the format.
- Use Node's stable `util.parseArgs()` before adopting a large CLI framework.
- Use the built-in `node:test` runner unless project needs outgrow it.
- Use ESLint for linting and Prettier for formatting, with documented `lint` and `format`/`format:check` scripts.

Do not rely on executing raw TypeScript in user environments. Node's native type stripping differs across versions, does not perform type checking, ignores `tsconfig.json` features, and is unnecessary when a normal build already exists. This restriction governs the distributed CLI only: tests are dev-only tooling, are written in TypeScript, and run directly via `tsx` layered on `node:test`, without a separate compile step.

### 16.2 Distribution

Primary installation:

```bash
npm install --global @vipentti/planlet
```

Occasional execution may also work through:

```bash
npx @vipentti/planlet list
```

However, installed or bundled execution is preferable for agents because it avoids repeated package resolution, network access, and version ambiguity.

Suggested package contents:

```text
package.json
dist/planlet.mjs
skills/planlet-plan/...
skills/planlet-implement/...
skills/planlet-complete/...
README.md
LICENSE
```

### 16.3 Alternatives

**Go** is the strongest alternative if a small, standalone native binary with no runtime dependency becomes a defining requirement. It offers fast startup and straightforward cross-compilation, at the cost of a separate binary release matrix and less direct npm/skill packaging.

**Bun** and **Deno** can compile TypeScript into standalone executables and may be useful for optional release binaries. Neither should be a mandatory runtime for the MVP because Node is more likely to be present in arbitrary agent environments.

**Rust** would provide excellent native binaries but adds complexity without a clear benefit for this filesystem-oriented tool.

**Python** would be productive for development, but global CLI installation is more variable because of Python versions, virtual environments, `pipx`, and externally managed installations.

## 17. Suggested Source Layout

```text
src/
├── cli.ts
├── commands/
│   ├── init.ts
│   ├── update.ts
│   ├── tools.ts
│   ├── list.ts
│   ├── create.ts
│   ├── show.ts
│   ├── status.ts
│   ├── validate.ts
│   ├── tasks.ts
│   ├── task-check.ts
│   ├── task-uncheck.ts
│   └── complete.ts
├── core/
│   ├── repository.ts
│   ├── paths.ts
│   ├── slugs.ts
│   ├── discovery.ts
│   ├── plan.ts
│   ├── task-parser.ts
│   ├── status.ts
│   ├── validation.ts
│   └── completion.ts
├── harnesses/
│   ├── registry.ts
│   ├── installer.ts
│   └── renderers/
├── output/
│   ├── model.ts
│   ├── toon.ts
│   ├── json.ts
│   └── human.ts
└── errors/
    ├── codes.ts
    └── planlet-error.ts

skills/
├── planlet-plan/
├── planlet-implement/
└── planlet-complete/

tests/
├── fixtures/
├── unit/
├── integration/
└── harnesses/
```

Keep the domain model independent from output formatting. For example:

```ts
interface PlanSummary {
  slug: string;
  archiveName?: string;
  completedAt?: string;
  title?: string;
  state:
    | "invalid"
    | "draft"
    | "planned"
    | "in_progress"
    | "ready_to_complete"
    | "completed";
  completedTasks: number;
  totalTasks: number;
  path: string;
  warnings: string[];
}
```

## 18. Safety and Filesystem Requirements

- Reject unsafe slugs before constructing paths.
- Resolve and verify all mutation targets remain under the repository root.
- Treat symlinks that escape the root as unsafe.
- Use atomic writes for `tasks.md` updates.
- Make whole-planlet creation atomic (see §10.5): prepare both new files and become visible as a single operation, so a crash or error mid-creation cannot leave a directory containing only one of `plan.md` or `tasks.md`.
- Do not shell out for ordinary file operations; the sole exception is the explicit-path `git add` used to stage files the CLI wrote (see the staging rule below).
- Never overwrite an existing active or completed planlet silently.
- Capture the completion timestamp once, derive the UTC archive date from that same value, and use both consistently in the completion record and destination path.
- Fail completion when the logical slug already exists in completed storage or when the computed date-prefixed destination directory already exists.
- Preserve both files during completion; completion is a move, not deletion.
- On partial failure, leave the source recoverable and report the exact state.
- Do not infer authorization to delete abandoned or invalid plans.
- Make task checking idempotent: checking an already checked task succeeds without duplicating changes.
- Per-planlet CLI write locks cover concurrent `task check` / `task uncheck` / `complete` in one repository working tree on one machine, for one user. Because the lock root lives in the OS temp directory, a single checkout mounted into separate machines, containers, or user accounts gets separate lock namespaces. Cross-branch edits of `tasks.md` still surface as ordinary git merge conflicts on checkbox lines.
- Optional precondition hashes remain a possible future hardening for non-CLI writers.
- When a command writes plan files inside a git working tree, it stages exactly those paths with an explicit-path `git add`, gated on a git marker so non-git roots never invoke git. Completion additionally removes the moved source from the index with `git rm --cached --ignore-unmatch`, so a planlet that was never tracked still stages its destination without a warning. The git-marker check walks from the selected root toward the filesystem root, recognizing explicit package subdirectories inside a parent worktree. Git failures become warnings, never command failures. The CLI never stages with `git add -A`, never commits, and never inspects working-tree cleanliness; index management otherwise remains the user's responsibility. Completion still uses a plain filesystem move; git detects the rename from the resulting delete-plus-add. Staging is unconditional in git roots: the `--no-stage` escape hatch was deliberately dropped by captain decision (2026-08-08), so it is not re-requested, and `create` never stages its transient H1 stubs.

## 19. Validation Rules

A valid active planlet should normally satisfy:

- Directory name is a valid slug.
- `plan.md` exists and is readable.
- `tasks.md` exists and is readable.
- `plan.md` contains an H1 title.
- `tasks.md` contains an H1 title.
- At least one recognized task exists for a non-draft planlet.
- Every recognized task has a valid ID.
- Task IDs are unique within the file.
- Checkbox syntax is valid.
- No completed-plan destination collision exists when completing.

A valid completed planlet should additionally satisfy:

- Its directory name is a valid `<YYYY-MM-DD>-<slug>` archive name.
- Its parsed logical slug satisfies the normal slug rules and remains unique across active and completed planlets.
- Its completion record contains a valid UTC timestamp and mode.
- Its archive date matches the UTC date of its recorded completion timestamp.

Warnings, rather than hard failures, may cover:

- Missing recommended `plan.md` sections.
- Very large plan or task files.
- A completed planlet containing unchecked tasks with a recorded override.
- A title that differs substantially from the slug.
- A plan that has not been modified in a long time before implementation.

The CLI should distinguish structural errors from advisory hygiene warnings.

## 20. Testing Strategy

### 20.1 Unit tests

- Slug validation.
- Completed archive-name construction, parsing, real-date validation, and UTC date derivation.
- Task-line parsing and normalization.
- Duplicate task detection.
- Derived lifecycle status.
- Output rendering for TOON, JSON, and human formats.
- Stable error codes and exit-code mapping.
- Harness registry and destination resolution.

### 20.2 Integration tests

- Repository-root discovery from nested directories.
- Initializing a clean fixture repository.
- Creating minimal H1-only `plan.md` and `tasks.md` scaffolds, including automatic `plans/` creation, deterministic title derivation, explicit titles, `draft` status, collision refusal, and cleanup after simulated partial failure.
- Populating and listing several active planlets.
- Checking and unchecking tasks idempotently.
- Completing a fully checked planlet.
- Recording a normal completion timestamp and moving to the corresponding date-prefixed archive path.
- Refusing incomplete completion.
- Completing with an explicit incomplete override and reason.
- Refusing logical-slug conflicts and date-prefixed archive collisions.
- Reporting malformed archive names and archive dates that disagree with recorded completion timestamps.
- Preventing path traversal and symlink escape.
- Installing and updating `.agents` and Claude skills, including the `agents` and `codex` tool IDs sharing one `.agents/skills` destination.
- Detecting modified generated skill files before overwrite.
- Verifying stdout, stderr, and exit codes separately.

### 20.3 Skill evaluation

Skills need scenario-based evaluation in addition to CLI tests:

- Vague feature request requiring exploration.
- Precise request requiring few or no questions.
- User declines persistence after planning.
- Revision that changes both plan and tasks.
- Implementation against a codebase that drifted after planning.
- Failing verification that must leave a task unchecked.
- Several active planlets requiring explicit selection.
- Completion with unfinished work requiring a warning and confirmation.
- The same workflow under `.agents/skills` (including Codex discovery) and Claude Code installations.

## 21. MVP Scope

### Phase 0: Dogfooding bootstrap

- Create the canonical `planlet-plan`, `planlet-implement`, and `planlet-complete` skill skeletons.
- Add shared `plan.md` and `tasks.md` templates based on the file contract in this document.
- Require an available `planlet` executable in the skills. The CLI-unavailable fallback is retired: skills never hand-create planlets, compute progress, update checkboxes, record completion, or move completed planlets, and an agent with no executable and no working install path stops and reports naming the missing executable rather than reimplementing CLI operations.
- Manually create the first planlet for implementing the CLI core and use it to exercise planning, implementation handoff, incremental task updates, and completion.

Phase 0 was temporary scaffolding for dogfooding, not a second implementation of Planlet's deterministic behavior. Skills should not grow their own general-purpose parser or lifecycle engine. The CLI-unavailable fallback was retired on 2026-08-05, once every lifecycle operation it covered existed in the published CLI; the skills require an available executable and stop with install guidance when none can be run. The bootstrap skills were revised during development; Phase 2 hardens them after the CLI contract exists.

### Phase 1: File and CLI core

- Repository discovery.
- Slug validation.
- `plans/` initialization.
- Create minimal valid draft scaffolds, plus list, show, status, tasks, and validate.
- Check and uncheck tasks.
- Complete and incomplete-override behavior.
- Compact default output using the official TOON library (`@toon-format/toon`); `--json`, `--human`, and `--quiet` are deferred beyond Phase 1.
- ESLint and Prettier tooling for the package scaffold.
- Unit and fixture-based integration tests, written in TypeScript and executed via `tsx` atop `node:test`.

### Phase 2: Core skills

- Harden the bootstrap `planlet-plan`, `planlet-implement`, and `planlet-complete` skills against the implemented CLI contract.
- Finalize plan and task templates.
- Test that the skills require the CLI and never describe a manual lifecycle fallback.
- Skill scenario evaluations.

### Phase 3: Harness installation

- Shared `.agents/skills` adapter for generic Agent Skills consumers and Codex.
- Claude Code `.claude/skills` adapter.
- Codex tool-ID support through the shared `.agents/skills` adapter, including duplicate-target coalescing.
- `planlet init --tools ...` and `planlet update --tools ...`.
- Generated-file protection and adapter tests.

### Phase 4: Packaging and polish

- npm package and `bin` entry.
- Bundled single-file JavaScript artifact.
- CI across supported operating systems and maintained Node versions.
- Installation documentation.
- Optional command adapters for harnesses that benefit from them.

## 22. Future Possibilities

- More harness adapters.
- User-level skill installation.
- Standalone Bun, Deno, Go, or Node single-executable releases.
- Plan renaming and reopening.
- Abandon or cancel lifecycle distinct from completion.
- Explicit task dependencies.
- Plan freshness and code-drift hints.
- Optimistic concurrency for simultaneous agents.
- Git metadata, commit, and pull-request references in completion notes.
- Hooks that show an active-plan dashboard at agent-session start.
- Optional integration with GitHub Issues or pull requests.
- A read-only web or terminal dashboard for human review.
- Bulk reporting across repositories while retaining one-plan-at-a-time mutation.

These should not complicate the initial two-file workflow prematurely.

## 23. Initial Product Acceptance Criteria

The initial product should be considered useful when:

1. A user can ask a supported agent to plan a code change.
2. The skill investigates and discusses the request before writing files.
3. The user confirms persistence and receives `plans/<slug>/plan.md` and `tasks.md`.
4. Another fresh agent session can understand the work using only the repository and those files.
5. The Implement skill completes tasks and updates checkboxes incrementally.
6. The CLI lists several active planlets with accurate compact progress.
7. Every implementation and completion operation targets one explicit planlet.
8. The CLI refuses normal completion while tasks remain unchecked.
9. The Complete skill warns the user and obtains confirmation before an incomplete override.
10. Completion records one full UTC timestamp and moves both files into the matching `plans/completed/<YYYY-MM-DD>-<slug>` archive without data loss or changing the logical slug.
11. The same canonical skills can be installed for generic Agent Skills consumers, Claude Code, and Codex, with Codex using the shared `.agents/skills` destination.
12. CLI behavior is deterministic and useful in both interactive sessions and CI.

## 24. Open Design Questions

The following decisions can be resolved during prototyping:

- Whether installed skills should invoke a global `planlet` binary or include a synchronized bundled CLI.
- Whether Claude-style command adapters provide enough value beyond skills to include in the MVP.
- Whether incomplete completion records belong in `tasks.md` or a short section in `plan.md`.
- Whether Node 22 should remain supported once Node 24 is ubiquitous in agent environments.
- Whether plan freshness should be based on timestamps, Git commits, or remain purely advisory.

None of these questions blocks the central product contract.

## 25. Related Projects and References

- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — main inspiration for the explore/propose/apply/archive lifecycle and multi-harness installation approach.
- [OpenSpec Explore](https://github.com/Fission-AI/OpenSpec/blob/main/docs/explore.md) — conversational investigation before artifact creation.
- [OpenSpec Supported Tools](https://github.com/Fission-AI/OpenSpec/blob/main/docs/supported-tools.md) — reference for tool IDs, skill destinations, and thin harness adapters.
- [Agent Skills specification](https://agentskills.io/specification) — canonical portable `SKILL.md` format.
- [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills) — Codex skill discovery locations and invocation behavior.
- [AXI](https://github.com/kunchenguid/axi) — agent-ergonomic CLI principles including compact output, minimal schemas, structured errors, and contextual disclosure.
- [SpecOps](https://github.com/JarvusInnovations/specops) — adjacent example of a deterministic TypeScript/Node CLI over repository-local planning files.
- [PlanKit](https://github.com/FlineDev/PlanKit) — adjacent conversational planning and archival workflow, with more roadmap structure than Planlet intends to require.
- [Kiro Specs](https://kiro.dev/docs/cli/v3/specs/) — example of plan-then-execute behavior and editable repository-local artifacts.
- [Node.js TypeScript documentation](https://nodejs.org/api/typescript.html) — runtime TypeScript behavior and reasons to distribute compiled JavaScript.
- [Node.js `util.parseArgs`](https://nodejs.org/api/util.html#utilparseargsconfig) — dependency-free argument parsing suitable for the initial CLI.
- [Bun standalone executables](https://bun.com/docs/bundler/executables) and [Deno compile](https://docs.deno.com/runtime/reference/cli/compile/) — possible future standalone TypeScript distribution options.

# Bootstrap Planlet Skills

## Summary

Create the first canonical versions of the `planlet-plan`, `planlet-implement`, and `planlet-complete` agent skills so Planlet can be dogfooded before its CLI exists. The skills will operate on the repository-local `plan.md` and `tasks.md` contract, use a deliberately narrow manual fallback for deterministic operations, and be structured for later installation into multiple agent harnesses.

## Motivation

Planlet currently has a product and technical design but no executable CLI or workflow skills. Waiting for the complete CLI before exercising the workflow would delay feedback on the most important product behavior: whether an agent can create a useful plan, hand it to a fresh implementation session, track work accurately, and complete it safely.

Bootstrap skills make that workflow usable immediately. They also provide concrete consumers for the earliest CLI commands, allowing the CLI contract to be shaped by real agent needs rather than designed only in the abstract.

## Scope

Implement canonical, project-owned skill sources under `skills/`:

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

The implementation will:

- Give every skill concise Agent Skills-compatible frontmatter whose description identifies both its behavior and triggering situations.
- Keep each `SKILL.md` focused on the essential workflow, loading detailed guidance only when needed.
- Define clear ownership boundaries between agent judgment and deterministic lifecycle mechanics.
- Prefer the `planlet` CLI whenever the required command is available.
- Provide an explicit CLI-unavailable fallback for bootstrapping this repository.
- Preserve the one-planlet-per-mutating-workflow rule.
- Make the skills usable through natural-language requests as well as harness-specific invocation syntax.
- Add scenario-based evaluations or fixtures outside the skill directories.

### Planning workflow

`planlet-plan` will combine exploration and proposal into one conversational workflow. It will inspect the repository, resolve material uncertainties, recommend an approach, and present the proposed plan and task breakdown before persisting anything. It may create or revise planning artifacts after user confirmation, but it must not modify product code.

For revisions, the skill will read both files again, preserve IDs for unchanged tasks, reconcile changed scope across both files, and avoid silently deleting completed work.

### Implementation workflow

`planlet-implement` will resolve exactly one active planlet, read both files completely, inspect the current repository, and compare current conditions with the persisted plan before editing code. It will implement tasks in a sensible order and mark each task complete only after its work and relevant verification succeed.

The skill will pause or seek direction when the plan is materially stale, a task is ambiguous, verification fails, or newly discovered work would expand scope. It will not complete or archive the planlet unless the user also explicitly requested that lifecycle action.

### Completion workflow

`planlet-complete` will resolve exactly one active planlet, validate its structure, and inspect remaining tasks. Normal completion requires every task to be checked. Incomplete completion requires a clear warning, explicit user confirmation, and a recorded reason before the planlet is moved.

Malformed or missing files must never be treated as completed work. Completion will capture one UTC timestamp, record it in `tasks.md`, derive the archive date from the same instant, and move the planlet to `plans/completed/<YYYY-MM-DD>-<slug>` without changing its logical slug. A logical-slug conflict or destination collision must stop the operation without altering the source planlet.

## CLI-Unavailable Bootstrap Behavior

At the beginning of a workflow, each skill will determine whether the required `planlet` command is available. CLI use is preferred whenever possible. If it is unavailable, the skill may perform only the equivalent repository-local operations needed for its own workflow and must announce that fallback behavior is active.

The fallback will follow the contract in `planlet_design.md`, including:

- Discovering the repository root without traversing beyond it.
- Accepting only slugs that match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Refusing ambiguous selection when several active planlets exist.
- Requiring readable `plan.md` and `tasks.md` files with H1 titles.
- Recognizing only top-level task lines shaped as `- [ ] T<number> ...` or `- [x] T<number> ...`.
- Preserving stable, unique task IDs and assigning new IDs above the highest numeric suffix.
- Updating task checkboxes carefully and reporting which CLI validation could not be run.
- Capturing one UTC completion timestamp and safely moving to `plans/completed/<YYYY-MM-DD>-<slug>` only after logical-slug, destination-collision, and completion checks.
- Recording the full timestamp and completion mode for every completion, plus the remaining task IDs and reason for any explicitly approved incomplete completion.

The fallback is scaffolding, not a general Markdown parser or parallel lifecycle implementation. As the CLI gains a required operation, the corresponding skill path will delegate to it. Detailed fallback instructions should remain small enough to remove or substantially reduce during Phase 2.

## Approach

### 1. Establish shared conventions

Define a short set of conventions used consistently across all three skills:

- How a target planlet is selected and announced.
- When repository files must be re-read instead of relying on conversation memory.
- How CLI availability and fallback use are reported.
- Which events require user confirmation.
- What constitutes a blocker, a plan deviation, and a completed task.
- What every final workflow summary must communicate.

These conventions should be expressed in each relevant skill rather than introduced through a shared runtime file that could break self-contained installation.

### 2. Build concise skill entry points

Initialize each skill using the repository's chosen skill scaffolding process, then replace generated placeholders with original Planlet-specific instructions. Keep the main skill bodies procedural and concise. Put nuanced guidance and examples in the referenced files, avoiding duplicated text between `SKILL.md` and references.

Skill instructions will use imperative language and avoid assumptions about harness-specific tools. They may describe capabilities such as asking the user, inspecting files, or executing the CLI without naming a vendor-only interaction mechanism.

### 3. Create reusable planning assets

Add `plan.md` and `tasks.md` templates as output assets of `planlet-plan`. Templates will reflect the file contract without forcing empty ceremonial sections. Planning guidance will explain when optional sections add value and how to convert acceptance criteria into verifiable tasks.

### 4. Keep workflows distinct

Maintain three clear lifecycle responsibilities:

| Skill | Primary result | Must not do implicitly |
|---|---|---|
| `planlet-plan` | Confirmed `plan.md` and `tasks.md` | Change product code |
| `planlet-implement` | Implemented and verified tasks with current checkboxes | Complete/archive the planlet |
| `planlet-complete` | Safely moved, date-prefixed completed planlet with a completion audit trail | Implement remaining work |

This separation keeps invocation intent predictable while still allowing a user to explicitly request sequential workflows.

### 5. Validate structure and behavior

Run structural skill validation for each skill. Add scenario coverage for vague and precise planning requests, abandoned persistence, plan revision, ambiguous target selection, repository drift, failed verification, normal completion, and incomplete override confirmation.

Finally, use the bootstrap skills on this planlet and at least one subsequent CLI planlet. Record discovered changes directly in the canonical skill sources and keep this task list current throughout implementation.

## Inspiration and Originality Boundary

The OpenSpec `explore`, `propose`, `apply-change`, and `archive-change` skills may be studied as workflow references. Useful high-level patterns include grounding exploration in the repository, separating planning from implementation, resolving a single target, re-reading persisted artifacts, showing progress, pausing on material conflicts, and checking completion before archival.

Planlet's implementation must be written independently for its own lifecycle. It must not copy OpenSpec wording, examples, command sequences, output blocks, or schema-specific mechanics. In particular, Planlet combines exploration and proposal, has exactly two primary files, derives state from checkboxes and location, has no artifact dependency graph or permanent specification sync, and requires its own CLI-optional bootstrap behavior.

References consulted during planning:

- [OpenSpec skills directory](https://github.com/Fission-AI/OpenSpec/tree/main/skills)
- [OpenSpec explore skill](https://github.com/Fission-AI/OpenSpec/blob/main/skills/openspec-explore/SKILL.md)
- [OpenSpec propose skill](https://github.com/Fission-AI/OpenSpec/blob/main/skills/openspec-propose/SKILL.md)
- [OpenSpec apply-change skill](https://github.com/Fission-AI/OpenSpec/blob/main/skills/openspec-apply-change/SKILL.md)
- [OpenSpec archive-change skill](https://github.com/Fission-AI/OpenSpec/blob/main/skills/openspec-archive-change/SKILL.md)

## Out of Scope

- Implementing the Planlet CLI.
- Building harness installers or generated copies under `.agents/`, `.claude/`, or `.codex/`.
- Adding harness-specific slash-command adapters.
- Publishing skills to a registry or npm package.
- Supporting user-level skill installation.
- Creating additional Planlet lifecycle skills.
- Implementing concurrency, file locks, or optimistic hashes.
- Reproducing OpenSpec's artifact graph, permanent specifications, or spec synchronization.

## Acceptance Criteria

- Canonical `planlet-plan`, `planlet-implement`, and `planlet-complete` skill directories exist under `skills/` and pass the selected structural validator.
- Each skill has valid `name` and `description` frontmatter that makes its intended triggers distinguishable from the other two skills.
- `planlet-plan` inspects the repository, keeps planning separate from product implementation, obtains confirmation before persistence, and creates or revises both Planlet files consistently.
- `planlet-implement` selects one planlet, re-reads both files, checks current repository conditions, updates tasks incrementally, and leaves failed or unverified tasks unchecked.
- `planlet-complete` refuses unsafe or ambiguous completion, records a UTC completion timestamp, uses its date in the archive name, and obtains explicit confirmation plus a reason before an incomplete override.
- All skills prefer available CLI commands but can dogfood the repository through a clearly announced, narrowly scoped manual fallback.
- The manual fallback follows the Planlet slug, file, task, selection, and completion safety contracts without becoming a general-purpose parser.
- Plan and task templates are useful to a fresh agent and avoid unnecessary documentation ceremony.
- Scenario evaluations cover the primary workflow, ambiguity, failure, drift, revision, and override cases.
- Skill content is original Planlet-specific work; external projects are credited as inspiration without copied instruction text or borrowed product-specific mechanics.
- This planlet is exercised using the bootstrap workflow, with task checkboxes updated as work is implemented and verified.

## Verification

- Run the skill scaffolding validator against all three skill directories.
- Inspect frontmatter parsing, skill names, and descriptions.
- Review every referenced resource path from each `SKILL.md` and confirm it exists.
- Confirm the skill directories contain no placeholder or unnecessary auxiliary files.
- Run scenario evaluations with fresh agent context where practical and inspect the resulting artifacts, diffs, and workflow decisions.
- Exercise the CLI-unavailable paths against disposable repository fixtures, including UTC-derived archive naming and collision handling, before using completion behavior on a real planlet.
- Compare resulting planlets with the structural rules in `planlet_design.md`.
- Search the new skills for suspiciously matching external phrasing and rewrite anything that is not independently expressed.

## Risks and Considerations

- Manual fallback instructions can drift from the future CLI. Keep them narrow, mark their use visibly, and replace deterministic behavior with CLI calls as soon as commands exist.
- Overly long skills consume agent context and can obscure the critical workflow. Keep entry points compact and use progressive disclosure for nuanced guidance.
- Overly rigid planning questions can turn a lightweight workflow into ceremony. Ask only questions whose answers materially affect scope, approach, acceptance, or verification.
- Harness-specific tool names can undermine portability. Describe intentions and outcomes using generic agent capabilities.
- Checking tasks too early can produce false progress. Require both implementation and relevant verification before completion.
- A permissive manual completion path could lose or misclassify work. Capture the timestamp once, validate the exact logical slug, source, completion record, and date-prefixed destination, refuse conflicts and collisions, and require explicit incomplete-work confirmation.
- New project-local skills may not be discovered by an already-running agent session until installed or a new session begins. Phase 0 produces canonical sources; harness installation remains a later phase.

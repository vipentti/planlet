# Planlet Skill Scenarios

Run each scenario in a fresh disposable repository fixture outside the canonical `skills/` tree and active `plans/` state. Copy only the files named by the setup, start with fresh agent context where practical, and retain the prompt, agent output, resulting files, and diff for review. Require CLI-first behavior for lifecycle operations with no manual lifecycle fallback; an agent that cannot run the CLI for such an operation stops and reports naming the missing executable.

## Planning scenarios

### S1 Vague request

- Fixture: A small repository with instructions, source, tests, and no active planlets.
- Prompt: "Plan a better import experience." Stage the answers: answer only the first batch, then any follow-up batch.
- Expected decisions: Inspect relevant code; look up repository facts instead of asking; surface material open decisions in small related batches (prefer about 2–4) with a recommended answer and brief rationale for each; ask outcome and scope first and hold technical choices that depend on them until the staged answers settle them; recommend a bounded approach; propose a valid unused slug; once answers settle the decisions, persist without presenting the plan or asking to write.
- Expected artifacts: None while material questions are open; afterward, exactly one valid `plan.md` and `tasks.md` whose acceptance criteria and tasks reflect the answered scope, plus a brief report that does not reproduce the plan.
- Safety checks: No product edits, extra documents, persistence before material questions are answered, or confirmation prompt to write.

### S2 Precise request

- Fixture: A repository whose existing interface and tests make the requested change unambiguous.
- Prompt: Specify the target behavior, compatibility constraint, and required test in detail.
- Expected decisions: Inspect the repository; if the request is already precise, proceed without ceremonial questions; persist the planlet directly with verification strategy.
- Expected artifacts: A valid two-file planlet with an unused slug and verifiable tasks, written without a confirmation round, and a brief report naming paths and the validation result.
- Safety checks: No ceremonial sections without content, no plan reproduced in conversation, and no implementation edits.

### S3 Discussion-only request

- Fixture: Any repository without the proposed slug, with no `planlet` executable available.
- Prompt: Ask to brainstorm and compare approaches for a change, explicitly without saving a plan.
- Expected decisions: Answer in conversation only, without installing, invoking, or requiring the CLI.
- Expected artifacts: No new planlet directory or files.
- Safety checks: Repository diff remains empty.

### S4 Plan revision with partial completion

- Fixture: One valid active planlet with checked T1 and T2, followed by unchecked T3 (create schema) and T4 (document schema). Checked T2 has an indented nested line "- Related: T4". `plan.md` mentions T3 and T4.
- Prompt: Revise scope so T4 is removed, add "deploy schema" with preferred placement immediately after T2, noting that it depends on unfinished T3, and add "add audit log" as a new prerequisite of checked T1.
- Expected decisions: Apply the requested revision directly without a confirmation round; re-read both files; keep T1 and T2 IDs, text, nested line, and checkboxes unchanged; place "deploy schema" after T3 because it depends on the schema and report the adjusted position; refuse the audit-log insertion, report that it invalidates completed T1, and wait for an approved resolution; renumber the suffix from T3; delete or rewrite `plan.md` references to removed T4 before the new T4 reuses that ID; report the mapping, removed T4, and the nested line on T2 that now names different work.
- Expected artifacts: Both files updated consistently; prefix unchanged byte for byte; suffix numbered T3, T4.
- Safety checks: No new task before or between checked tasks, no edit to checked text, no duplicate IDs, and no product edits.

### S14 Renumbering before any completion

- Fixture: One valid active planlet with unchecked T1 through T10 in order, where `plan.md` mentions T1 and T10, T5's description says "after T3", and a free-form note under the task list says "T2 blocks T10".
- Prompt: Insert a new task between T2 and T3, remove T6, and move T9 before T7.
- Expected decisions: Re-read both files; edit tasks as requested; renumber the whole list sequentially from T1 in file order; reconcile references to removed T6 first; apply one old-to-new mapping to `plan.md`, unchecked descriptions, and the note, matching whole IDs so T1 never matches inside T10; report the mapping and removed ID.
- Expected artifacts: Tasks numbered T1 through T10 in file order with every reference pointing at the same work as before.
- Safety checks: No sequential-replacement corruption, no stale reference to removed work, and no product edits.

### S15 Out-of-order completion

- Fixture: One valid active planlet with `[x] T1`, `[ ] T3`, `[x] T2`, `[ ] T4`.
- Prompt: Remove T3. Variants: move T3 after T4; add a new task that T3 depends on.
- Expected decisions: Treat checked T2 as the boundary. Base run: remove T3, renumber T4 to T3, and report removed T3 and its reuse. Move variant: refuse, make no edit for that part, and suggest removing T3 plus a new suffix task. Prerequisite variant: refuse the insertion, report the conflict, and require approval to remove T3 and recreate it after its new prerequisite.
- Expected artifacts: Base run leaves `[x] T1`, `[x] T2`, `[ ] T3`; refused variants leave the task list unchanged.
- Safety checks: Unchecked T3 is never moved past a checked task without explicit approval, and checked T1 and T2 never change.

### S12 Contradicted premise

- Fixture: A small CLI repository whose slow command repeats the same filesystem reads in a loop and has no network or cache dependency.
- Prompt: "The CLI is slow because it has no cache. Plan adding Redis caching." Variant: "We standardize on Redis across services, so plan Redis caching."
- Expected decisions: Investigate where the time goes before planning; separate the problem from the proposed solution; challenge the contradicted premise with repository evidence and recommend removing the repeated reads. In the variant, treat Redis as a required constraint, plan within it, and state the objection once.
- Expected artifacts: A valid two-file planlet once decisions settle; the base run plans the simpler fix or records the user's choice after the challenge; the variant plans Redis and notes the objection.
- Safety checks: No Redis plan before the premise is checked; no silent override of the variant's requirement; no product edits.

### S13 Recommendation-led user

- Fixture: A repository where the requested change has two or three material technical choices.
- Prompt: A short request from a user who says they do not know the technical options; reply "use your recommendations" to the first batch. Variant: override one recommendation and leave one minor item unanswered.
- Expected decisions: Each question carries one recommendation with a brief rationale and an alternative only when meaningful; accept the whole batch from one reply and persist without further questions once the stop condition holds. In the variant, ask again only if the unanswered item is material.
- Expected artifacts: A valid two-file planlet reflecting the accepted recommendations. In the variant, `plan.md` states the override as the user's decision and the unanswered minor item as the agent's assumption.
- Safety checks: No invented alternatives, no extra confirmation round, and no unconfirmed recommendation presented as the user's decision.

## Implementation scenarios

### S5 Multiple active planlets

- Fixture: Two valid active planlets and one completed archive.
- Prompt: "Implement the planlet" without a slug.
- Expected decisions: List or identify the active choices and request one exact target.
- Expected artifacts: None before selection.
- Safety checks: Never select by order, age, or inferred priority.

### S6 Repository drift

- Fixture: One valid planlet whose approach assumes an interface that has since been replaced.
- Prompt: Implement that slug.
- Expected decisions: Re-read both files, inspect current code, identify the invalid assumption with evidence, and pause with a revision recommendation.
- Expected artifacts: No unrelated implementation; affected tasks remain unchecked.
- Safety checks: Do not silently substitute a materially different design.

### S7 Failed verification

- Fixture: One planlet with a task whose implementation can be made but whose relevant test fails.
- Prompt: Implement that slug.
- Expected decisions: Run the test, report the failure, attempt only an authorized in-scope remedy, and leave the task unchecked if verification still fails.
- Expected artifacts: Implementation diff and truthful unchanged checkbox; exact verification output retained.
- Safety checks: No false progress or archival.

### S16 Scope addition during implementation

- Fixture: One valid active planlet with checked T1, unchecked T2 and T3, and a `plan.md` reference to T3, whose implementation reveals necessary unplanned work that must precede T3.
- Prompt: Implement that slug and approve the material scope addition when proposed.
- Expected decisions: Propose consistent `plan.md` and `tasks.md` edits; insert the new task after checked T1 at the earliest position that precedes old T3; renumber the unchecked suffix sequentially so old T3 becomes T4; rewrite the `plan.md` reference through the mapping; report the mapping.
- Expected artifacts: Checked T1 unchanged; unchecked tasks T2, T3, T4 in file order with the new task before old T3; implementation diff limited to the planlet's scope.
- Safety checks: No checked ID or text changes, and no task checked before its verification passes.

## Completion scenarios

### S8 Normal UTC-dated completion

- Fixture: One valid active planlet with all tasks checked and no completed logical-slug or destination conflict. Control the completion instant near a UTC date boundary.
- Prompt: Complete the explicit slug.
- Expected decisions: Validate, capture one UTC instant, append a normal completion record, derive the date from that instant, and move the directory.
- Expected artifacts: `plans/completed/<UTC-date>-<slug>/{plan.md,tasks.md}` with matching timestamp and mode.
- Safety checks: Source no longer exists only after the move; both primary files remain intact; local timezone does not affect the date.

### S9 Logical-slug conflict

- Fixture: An active `sample-change` and a valid completed archive named with another date but the same logical slug.
- Prompt: Complete `sample-change`.
- Expected decisions: Detect the logical-slug conflict and refuse before recording completion.
- Expected artifacts: Active source unchanged.
- Safety checks: No destination creation, overwrite, merge, or source movement.

### S10 Destination collision

- Fixture: A complete active planlet and an existing archive at the exact date-derived destination.
- Prompt: Complete the active slug.
- Expected decisions: Refuse the occupied destination before changing the source.
- Expected artifacts: Both existing directories unchanged.
- Safety checks: No overwrite, merge, alternate suffix, or second clock read.

### S11 Incomplete completion override

- Fixture: A valid active planlet with T2 and T4 unchecked and no archive conflicts.
- Prompt: Complete the slug; first withhold confirmation, then explicitly approve with the reason "Deployment moved to a separate release plan."
- Expected decisions: Initially list T2 and T4, warn, and make no edits. After explicit approval and reason, record incomplete-override mode, remaining IDs, reason, and one UTC timestamp before moving.
- Expected artifacts: A date-prefixed archive retaining unchecked tasks and the complete audit record.
- Safety checks: General implementation approval is not accepted as override consent; an empty reason stops the operation.

## Review criteria

For every lifecycle run, confirm exact target selection, complete file re-reading, CLI-first delegation, valid paths and task IDs, narrow mutation scope, accurate final summary, and preservation of fixture changes unrelated to the scenario. For S3, confirm the agent neither installs nor invokes the CLI and leaves the repository unchanged. Revise a skill when its raw output or diff is unsafe, ambiguous, inconsistent across the two files, or needlessly ceremonial.

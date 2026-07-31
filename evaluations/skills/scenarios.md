# Planlet Skill Scenarios

Run each scenario in a fresh disposable repository fixture outside the canonical `skills/` tree and active `plans/` state. Copy only the files named by the setup, start with fresh agent context where practical, and retain the prompt, agent output, resulting files, and diff for review. Require CLI-first behavior; where a scenario falls back to manual handling, require an explicit disclosure naming the deterministic checks that were skipped.

## Planning scenarios

### S1 Vague request

- Fixture: A small repository with instructions, source, tests, and no active planlets.
- Prompt: "Plan a better import experience."
- Expected decisions: Inspect relevant code; ask only questions that change the outcome; recommend a bounded approach; propose a valid unused slug; wait for confirmation.
- Expected artifacts: None before confirmation; afterward, exactly one `plan.md` and `tasks.md` whose acceptance criteria and tasks reflect the confirmed scope.
- Safety checks: No product edits, extra documents, or premature persistence.

### S2 Precise request

- Fixture: A repository whose existing interface and tests make the requested change unambiguous.
- Prompt: Specify the target behavior, compatibility constraint, and required test in detail.
- Expected decisions: Inspect the repository, avoid unnecessary questions, and present a direct proposal with verification.
- Expected artifacts: A confirmed two-file planlet with a valid unused slug and verifiable tasks.
- Safety checks: No ceremonial sections without content and no implementation edits.

### S3 Declined persistence

- Fixture: Any repository without the proposed slug.
- Prompt: Request a plan, review the proposal, then decline file creation.
- Expected decisions: Accept the decline and preserve the conversational proposal only.
- Expected artifacts: No new planlet directory or files.
- Safety checks: Repository diff remains empty.

### S4 Plan revision

- Fixture: One valid active planlet containing completed T1, unfinished T2, and a highest historical ID of T4.
- Prompt: Revise scope so T2 remains applicable, one unfinished outcome is removed, and one new outcome is added.
- Expected decisions: Re-read both files; reconcile scope and tasks; preserve T1 and T2 IDs; explain any effect on completed T1; allocate the new task at T5 or above.
- Expected artifacts: Both files updated consistently with no silent deletion of completed work.
- Safety checks: No renumbering, duplicate IDs, or product edits.

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

For every run, confirm exact target selection, complete file re-reading, CLI-first delegation or explicit fallback disclosure, valid paths and task IDs, narrow mutation scope, accurate final summary, and preservation of fixture changes unrelated to the scenario. Revise a skill when its raw output or diff is unsafe, ambiguous, inconsistent across the two files, or needlessly ceremonial.

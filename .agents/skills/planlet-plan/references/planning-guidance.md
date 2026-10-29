# Planning Guidance

## One ownership rule

`plan.md` owns the shared design and acceptance requirements: intended
outcome, scope and exclusions, approach and invariants, acceptance criteria,
broad verification strategy, and material risks. `tasks.md` names ordered
delivered outcomes: one outcome per task, prerequisites before their
consumers, unique T-IDs, and a short task-specific `Verify:` clause only when
useful. State each material requirement once in its owning file; a task is
understandable after reading `plan.md` and must not duplicate detailed plan
requirements. An
implementer reads both files completely before starting.

When several tasks are governed by one safety, compatibility, migration, or
ordering rule, state that rule once in Approach or Acceptance Criteria.

## Verification evidence is exceptional

`Verification` is strategy, not a run log. Name stable repository commands or
check categories, expected outcomes, external gates, and known limitations;
never paste logs. Do not record execution results in `plan.md`; a later
strategy or scope change is a plan revision, not an execution journal entry.

Committed verification evidence is exceptional and absent by default. Tests,
lint, type-checking, builds, ordinary pull-request review, and branch-protected
CI already hold their own results. Planning leaves `## Verification Evidence`
unwritten. When the work depends on a check whose residual result ordinary
Git, test, pull-request, or CI history cannot reconstruct (external,
irreversible, non-reproducible, failed, partial, or unavailable), say that
once in `## Verification` and stay silent otherwise. Implementation writes
the section in `tasks.md` only after such a result exists.

## Revision rules

Keep completed tasks unless the user explicitly approves a documented change.
If revised scope invalidates completed work, explain the effect and update both
files consistently. Avoid catch-all tasks such as "finish implementation" or
"test everything." Apply task ID normalization below to every revision that
edits `tasks.md`.

## Task ID normalization

The boundary is the last checked task by position in `tasks.md`, not the
highest numeric ID. The prefix is every task up to and including the boundary;
the suffix is every task after it. With no checked task the prefix is empty.
Position means order relative to other tasks, not line number.

- Checked tasks are immutable: keep each ID, description, checkbox state, and
  order relative to other checked tasks.
- An unchecked task inside the prefix (out-of-order completion) keeps its ID
  and its order relative to checked tasks. It may be removed when the revised
  scope no longer needs it. Refuse any request to reorder it or move it past a
  checked task; make no edit for that part, report the conflict, and suggest
  removing it and adding a new suffix task instead.
- New tasks go only into the suffix, never before or between checked tasks.
  When new work is requested at an earlier position, place it at the earliest
  suffix position that keeps every prerequisite before its consumer and report
  the adjusted position.
- When any prefix task depends on the new work, refuse that insertion and
  report the conflict. For an unchecked consumer, proceed only after the user
  explicitly approves removing it and recreating it in the suffix after its new
  prerequisite. For a checked consumer, also state that the completed work is
  invalidated, change no checked history, and wait for the user to approve a
  resolution, such as prerequisite plus redo tasks in the suffix.
- Within the suffix, insert, remove, and reorder tasks as the revised plan
  requires.
- Renumber the suffix sequentially in file order starting at one greater than
  the highest ID in the prefix (`T1` when the prefix is empty). Removed IDs may
  be reused.

A task description includes its indented continuation lines and nested list
lines. Mutable text is `plan.md`, unchecked task descriptions, and free-form
notes in `tasks.md` outside any task description, `## Verification Evidence`,
and `## Completion`. Before
renumbering, delete or rewrite every mutable reference to a removed task ID,
because its ID may be reused for different work. Then build the complete
old-to-new mapping and rewrite every mutable reference in one pass, matching
whole IDs only so `T1` never matches inside `T10`. Never apply replacements one
after another: `T3` to `T4` followed by `T4` to `T5` corrupts the first result.

Checked task descriptions, including their continuation and nested lines,
`## Verification Evidence` lines, and completion records are write-once. When such text names a removed or renumbered ID, report
each occurrence and the work that ID now denotes. Never normalize a completed
or archived planlet.

The CLI validates only current structure: task syntax, valid IDs, and unique
IDs. It cannot tell whether a task was inserted before previously checked
work, so these rules are enforced here, not by validation.

## Persist, then review

Write the planlet once material decisions are settled; do not present the
proposed files in conversation or ask for confirmation first. Creating a
planlet is not approving it, and approving it is not implementing it: the two
persisted files are reviewable drafts, and implementation needs a separate
request. Ask unresolved material decisions before creation, never after.
Explicit discussion-only requests, such as brainstorming or comparing options
without saving, stay conversational and leave the repository unchanged.

For a new planlet, populate only stubs produced by `planlet create`. For a
requested revision, re-read current files immediately before editing and
reconcile both documents in one reviewable change. In either case, targeted
CLI validation and full post-write inspection must succeed before reporting a
valid handoff. Report only consequential assumptions and unresolved concerns;
the user reviews the files, so do not restate them in conversation.

## Handle failures

Treat CLI exit status and structured error code as authoritative. Do not depend
on field order, whitespace, or incidental TOON formatting. Stop on unsafe path,
invalid slug, collision, write conflict, or invalid-plan errors; report code
and suggested next action without bypassing CLI. Warnings require review but do
not automatically invalidate a structurally valid planlet.

## Keep the handoff concise

Write the smallest plan that preserves consequential decisions. Avoid exhaustive
implementation walkthroughs, test-case matrices, historical reasoning, and
incidental edit sequences unless they remove material ambiguity.

Tasks must not duplicate detailed plan requirements, but may repeat a small
constraint when needed for task clarity. Prefer one concise outcome sentence,
ideally 25 words or fewer; a complete task normally stays within 50 words
including any `Verify:` clause or nested list. These are planner judgment
targets, not parser or validator thresholds, and no tool enforces them.

Before persisting the planlet, run a compression pass: reread the draft
`tasks.md` against `plan.md` and delete every detail an implementer can recover
unambiguously from `plan.md`. Keep only detail whose removal would leave the
outcome or its ownership genuinely ambiguous. Compression relocates detail,
never drops a requirement.

Task-local metadata is exceptional. A bare outcome line is the default and the
exemplar. The short `Verify:` clause stays available only when useful, when it
makes the task shorter or clearer and the information is not recoverable from
`plan.md`. Broad suite execution belongs to the distinct final verification
task, never to a task-local clause.

Ordinary nested Markdown lists remain allowed sparingly and must not become
another specification surface. If substantial explanation is needed, move it
into `plan.md` rather than keeping it in `tasks.md`.

Task boundaries follow independently meaningful delivered outcomes, the sole
split criterion. A task may contain several independently testable or
reviewable components and several requirements when they together serve one
coherent delivered outcome; keep those requirements in `plan.md`. Split only
when every resulting checkbox can stand as its own coherent delivered outcome,
splitting rather than compressing. Separate implementability or verifiability
is only evidence for that boundary, never sufficient on its own. Do not let
word-count pressure change semantic task boundaries, and do not split
mechanically by file, function, tiny edit, or incidental implementation step.

# Task ID Normalization

## Summary

Task IDs today never change: every new task gets one greater than the highest
existing numeric suffix. Inserting a task mid-list therefore produces lists such
as `T1 T2 T6 T3 T4 T5`, which read badly for humans even though the CLI already
keeps file order independently of IDs.

This planlet replaces that rule with boundary-based normalization. Completed
tasks form an immutable prefix; unfinished tasks after the last completed task
may be inserted, removed, reordered, and renumbered sequentially. The change is
skill guidance and documentation only. CLI parsing, validation, checkbox
operations, and lifecycle behavior stay unchanged.

## Scope

Changes:

- `skills/planlet-plan/SKILL.md` (Persist or revise, revision paragraph; Finish
  report) and `skills/planlet-plan/references/planning-guidance.md` (Revision
  rules).
- `skills/planlet-implement/references/implementation-guidance.md`: the
  material-addition paragraph that allocates IDs above the highest suffix.
- `planlet_design.md`: §8.2 revision rules, §10 task-file rules (the
  "must not be renumbered" and "highest existing numeric suffix plus one"
  bullets), and §19 validation rules for the enforcement split.
- `AGENTS.md`: the working-rules bullet on stable IDs and highest-suffix
  allocation, and the file-conventions bullet "reordering tasks must not
  renumber them".
- `evaluations/skills/scenarios.md`, `tests/fixtures/skills/scenarios.json`,
  and the scenario ID list in `tests/skills/skill-contract.test.ts`.
- Regenerated tracked copies under `.claude/skills/` and `.agents/skills/` plus
  their `.planlet-manifest.json` files, produced only by
  `node dist/planlet.mjs update`.
- `CHANGELOG.md` `[Unreleased]`: published-skill behavior change.

Excluded:

- Any file under `src/`: no new command, flag, warning, parser change, or
  history tracking. A future explicit renumber operation is out of scope.
- `skills/planlet-complete/`: completion never edits task IDs.
- Existing completed archives under `plans/completed/`.
- New dependencies.

## Approach

**Adopted rule.** The completed-task boundary rule below replaces both the
current always-stable rule and the earlier "renumber during planning, freeze
during implementation" idea. Freezing all IDs once any task is checked is not
adopted.

**Boundary.** The boundary is the last checked task by position in `tasks.md`,
not the highest numeric ID. The prefix is every task up to and including the
boundary; the suffix is every task after it. With no checked task the prefix is
empty.

**Prefix is immutable for normalization.** Checked tasks keep their ID,
description, checkbox state, and order relative to each other. Position means
relative order throughout this plan, not line number: removing a line above a
checked task does not move it. An unchecked task inside the prefix
(legacy out-of-order completion, for example `[x] T1, [ ] T2, [x] T3`) keeps
its ID and its order relative to checked tasks; it is never moved across the
boundary, moved between checked tasks, or renumbered. The existing rule still
applies that completed work is never silently removed.

**Unchecked prefix tasks.** A revision may remove an unchecked prefix task
that the revised scope no longer needs; checked tasks keep their IDs and
relative order. The removed ID may be reused by suffix normalization (for
example, removing `T3` from `[x] T1, [ ] T3, [x] T2, [ ] T4` renumbers `T4` to
`T3`), so the removed-ID reconciliation and immutable-reference reporting
under Reference updates apply to it exactly as to a removed suffix task. A
revision that would reorder an unchecked prefix
task, or move it past a checked task, is refused: the skill makes no edit for
that part and reports the conflict, suggesting removal plus a new suffix task
instead. Other unchecked prefix edits follow normal revision rules.

**Insertion boundary.** New tasks go only into the suffix, never before or
between checked tasks. When a revision asks for new work at an earlier
position and nothing in the prefix depends on it, place it at the earliest
suffix position that keeps every prerequisite before its consumer (immediately
after the boundary unless a suffix task it depends on must come first) and
report the adjusted position (assumption: placing and reporting is
preferred over stopping). When any prefix task, checked or unchecked, depends
on the new work, appending would put a prerequisite after its consumer, so the
skill refuses that insertion and reports the conflict. For an unchecked
consumer, the resolution needs explicit user approval to remove it and
recreate it in the suffix after its new prerequisite. For a checked consumer,
the report also states that the completed work is invalidated, and the skill
makes no change to checked history; the user must explicitly approve a
resolution, such as adding the prerequisite plus redo work in the suffix or
unchecking through the CLI. The skill never resolves either case silently.

**Suffix is mutable.** Within the suffix, tasks may be inserted, removed, and
reordered as the revised plan requires.

**Normalization.** After any revision that edits `tasks.md`, renumber the
suffix sequentially in file order starting at one greater than the highest ID
in the prefix (`T1` when the prefix is empty). This also normalizes a legacy
out-of-order suffix the first time such a plan is revised. Removed unfinished
IDs may be reused; that is the accepted cost of readable numbering.

**Reference updates.** Mutable text is `plan.md`, the descriptions of
unchecked tasks, and free-form notes in `tasks.md` outside the
`## Verification Evidence` and `## Completion` sections. Before renumbering, reconcile every mutable reference to a
removed task ID: delete or rewrite it so no mutable text still names removed
work, because normalization may reuse that ID for different work. Then build
the complete old-to-new mapping before editing any text and rewrite every
mutable reference in one pass. Match whole IDs only, so `T1` never matches
inside `T10`, and never apply replacements one after another, which would let
`T3 -> T4` then `T4 -> T5` corrupt an earlier result.

Checked task descriptions, any `## Verification Evidence` lines, and any
completion record are write-once and are not rewritten. When such text names a
removed or renumbered ID, the report lists each occurrence and states which
work the ID now denotes, so a reused ID never acquires a new referent silently
(assumption: report rather than refuse).

**Report.** When any ID changed or was removed, the planning report lists the
old-to-new mapping and removed IDs so the user can follow the change.

**Completed planlets.** Archived planlets are never normalized. The planning
skill already refuses to revise a completed archive; that stays.

**Implementation-time additions.** `planlet-implement` applies the same
boundary and normalization rules when a material scope addition edits
`tasks.md`. Task IDs it reports as checked are in the prefix and so never
change.

**Enforcement split.** The CLI validates current structure only: task syntax,
valid IDs, and unique IDs. It has no edit history, so it cannot detect an
insertion before a previously checked task, a moved checked task, or a stale
reference. Skills enforce the boundary, insertion, normalization, and
reference rules. The CLI does not warn about non-sequential IDs either,
because legitimate prefixes (legacy out-of-order completion, removed checked
history) can be non-sequential. `planlet_design.md` §19 records this split so
nobody assumes the CLI blocks the insertion rule.

**Sync of skill copies.** Edit only canonical `skills/`; regenerate tracked
copies with `node dist/planlet.mjs update`. The existing contract test that
compares copies to canonical sources and the CI drift step catch divergence.

## Acceptance Criteria

- `planlet-plan` and `planlet-implement` guidance state the boundary,
  prefix immutability, suffix-only insertion, suffix normalization, the
  mapping-based reference update, and the never-normalize-archives rule, with
  no remaining instruction to always allocate above the highest suffix or to
  never renumber.
- `planlet_design.md` §8.2, §10, and §19 and `AGENTS.md` describe the same
  rule, and §19 states the CLI-versus-skill enforcement split.
- Scenarios cover: insertion, removal, and reordering with no checked task;
  `plan.md`, unchecked-description, and free-form `tasks.md` note references
  including an overlapping pair such as `T1`/`T10`; removal of a referenced task whose ID is then reused,
  including a checked description naming it; partial completion with stable
  prefix IDs and a request to insert between checked tasks, including displaced
  new work that depends on an unchecked suffix task and so lands after it;
  legacy
  out-of-order completion, where an unchecked prefix task stays in place, may
  be removed (including the non-monotonic `[x] T1, [ ] T3, [x] T2, [ ] T4`
  removal of `T3` that reuses it), a request to reorder it is refused and
  reported, and new prerequisite work for it is refused and reported; new
  prerequisite work for a checked prefix task, which is refused and reported
  as invalidating that completed work with checked history unchanged; and a
  `planlet-implement` material scope addition on a partially completed
  planlet.
- The scenario fixture pins evidence strings from the new guidance and
  `npm test` passes.
- Installed skill copies and manifests match canonical sources.
- `CHANGELOG.md` `[Unreleased]` describes the behavior change.
- No file under `src/` changes.

## Verification

Full repository suite in the documented `AGENTS.md` order, ending with
`git diff --check`. During uncommitted implementation, use
`git status --porcelain` only to confirm no unexpected files changed; an empty
status is expected only in a committed or CI checkout.

Targeted:

- `node dist/planlet.mjs --root . tools` reports every destination
  `installed` after `node dist/planlet.mjs update`.
- Search `skills/`, `planlet_design.md`, and `AGENTS.md` for leftover
  "highest numeric suffix", "highest existing", and "must not renumber"
  wording.
- `tests/skills/skill-contract.test.ts` passes with the new scenario IDs and
  evidence strings.

The contract test and wording search are static drift guards only; they do
not prove agent behavior. Behavior is checked after the installed copies are
regenerated, by running the normalization scenarios manually against those
regenerated copies, which match canonical sources byte for byte, on disposable
fixtures outside the repository: the
`planlet-plan` revision scenarios, plus one `planlet-implement` scenario where
an approved material scope addition edits a partially completed `tasks.md`.
Each run inspects the resulting task order, checked prefix, suffix IDs,
reported mapping, `plan.md` references, and diff against the scenario's
expectations. That run is not reconstructable from CI or test
history, so implementation records its outcome as one `## Verification
Evidence` line in `tasks.md`; if no agent harness is available to run it, that
line states the check was unavailable instead.

## Risks and Considerations

- References outside the repository (commit messages, PR descriptions, chat)
  to an unfinished task ID can point at different work after renumbering.
  Checked IDs never change, which covers the references that matter most.
- The boundary follows current checkbox state, so `planlet task uncheck` on
  the boundary task moves the boundary earlier and makes that task
  renumberable on the next revision.
- Because enforcement lives in skills, a hand edit can still violate the
  insertion rule without any CLI error.

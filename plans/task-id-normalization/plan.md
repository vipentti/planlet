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
description, checkbox state, and position. An unchecked task inside the prefix
(legacy out-of-order completion, for example `[x] T1, [ ] T2, [x] T3`) keeps
its ID and position; it is never moved across the boundary or renumbered. The
existing rule still applies that completed work is never silently removed.

**Insertion boundary.** New tasks go only into the suffix, never before or
between checked tasks. When a revision asks for new work at an earlier
position, place it immediately after the boundary and say so in the report
(assumption: placing and reporting is preferred over stopping).

**Suffix is mutable.** Within the suffix, tasks may be inserted, removed, and
reordered as the revised plan requires.

**Normalization.** After any revision that edits `tasks.md`, renumber the
suffix sequentially in file order starting at one greater than the highest ID
in the prefix (`T1` when the prefix is empty). This also normalizes a legacy
out-of-order suffix the first time such a plan is revised. Removed unfinished
IDs may be reused; that is the accepted cost of readable numbering.

**Reference updates.** Build the complete old-to-new mapping before editing
any text, then rewrite every reference in one pass: `plan.md`, and the
descriptions of unchecked tasks. Match whole IDs only, so `T1` never matches
inside `T10`, and never apply replacements one after another, which would let
`T3 -> T4` then `T4 -> T5` corrupt an earlier result. Checked task
descriptions, any `## Verification Evidence` lines, and any completion record
are write-once and are not rewritten; if such text names a renumbered ID, flag
it in the report instead (assumption).

**Report.** When any ID changed, the planning report lists the old-to-new
mapping so the user can follow the change.

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
  `plan.md` and unchecked-description references including an overlapping pair
  such as `T1`/`T10`; partial completion with stable prefix IDs and a request
  to insert between checked tasks; and legacy out-of-order completion keeping
  the unchecked prefix task in place.
- The scenario fixture pins evidence strings from the new guidance and
  `npm test` passes.
- Installed skill copies and manifests match canonical sources.
- `CHANGELOG.md` `[Unreleased]` describes the behavior change.
- No file under `src/` changes.

## Verification

Full repository suite in the documented `AGENTS.md` order, ending with
`git diff --check` and an empty `git status --porcelain`.

Targeted:

- `node dist/planlet.mjs --root . tools` reports every destination
  `installed` after `node dist/planlet.mjs update`.
- Search `skills/`, `planlet_design.md`, and `AGENTS.md` for leftover
  "highest numeric suffix", "highest existing", and "must not renumber"
  wording.
- `tests/skills/skill-contract.test.ts` passes with the new scenario IDs and
  evidence strings.

Skill scenarios are manual agent runs; this plan updates their expectations
but does not require running them.

## Risks and Considerations

- References outside the repository (commit messages, PR descriptions, chat)
  to an unfinished task ID can point at different work after renumbering.
  Checked IDs never change, which covers the references that matter most.
- The boundary follows current checkbox state, so `planlet task uncheck` on
  the boundary task moves the boundary earlier and makes that task
  renumberable on the next revision.
- Because enforcement lives in skills, a hand edit can still violate the
  insertion rule without any CLI error.

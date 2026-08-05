# Task Check Summary Output

## Summary

`planlet task check` and `planlet task uncheck` return post-write plan progress:
`state`, `done`, `total`, and a conditional `next`. The agent that ticks the
final box sees `ready_to_complete` and the handoff action in the same result
instead of having to remember to run `status`. Additive output only; no field
removed or renamed; no new dependency.

## Scope

In scope:

- Extend `UpdateTaskResult` in `src/core/task-update.ts` with `state`, `done`,
  `total`, and conditional `next`, populated on both return paths from tasks
  the command already computes (idempotent early return and post-write success
  return).
- Integration coverage in `tests/integration/task-update.test.ts` plus an
  output-shape assertion in the compiled-CLI test.
- Design-doc output-rules line and `CHANGELOG.md` `[Unreleased]` entry.
- One handoff sentence in `skills/planlet-implement/SKILL.md` step 6, skill
  regeneration of tracked copies, and skill-contract test/scenario updates.

Out of scope (captain decisions D2-D4):

- `planlet-implement` stays forbidden from archiving; it announces
  `ready_to_complete` and hands off to `planlet-complete`.
- No git hooks.
- No writing into a foreign repository's docs, and no opt-in flag in this plan.
- No `--json`/schemaVersion work, no diff or branch inspection, no
  "unchecked tasks" scold, and no hint changes on read-only `status`/`tasks`.

## Approach

Follow report sketch 5a in `src/core/task-update.ts`:

- Add `readonly state: PlanletState`, `readonly done: number`,
  `readonly total: number`, and `readonly next?: string` to
  `UpdateTaskResult`.
- Build the summary once with a small helper: call existing
  `deriveLifecycleState({ valid: true, location: "active", tasks })`, count
  completed tasks, and emit `next: "planlet complete <slug>"` only when state
  is `ready_to_complete`.
- The idempotent early return uses `validated.tasks`; the success return binds
  the currently discarded post-write `validatePlanletStructure` result and
  passes `revalidated.tasks`.
- `handleTaskUpdate` needs no change: it already spreads the result minus
  `warnings`, and TOON serialization carries the new fields automatically.

Follow report sketch 5b: append one sentence to step 6 of
`skills/planlet-implement/SKILL.md` so the ready handoff is announced at check
time while the archive boundary stays intact.

## Acceptance Criteria

- T1: `UpdateTaskResult` gains the four fields; both return paths populate them
  from tasks already in hand; `next` equals `planlet complete <slug>` exactly
  when `state` is `ready_to_complete` and is absent otherwise; idempotent
  `changed: false` returns the same summary fields; no other output field
  changes; no new dependency.
- T2: tests cover non-final check (`in_progress` with exact counts), final
  check (`ready_to_complete` with `next`), uncheck regression (state leaves
  `ready_to_complete`, `next` absent), and idempotent `changed: false` (fields
  still present); the compiled-CLI task-check test decodes stdout and asserts
  the new fields; `npm test` is green.
- T3: `planlet_design.md` §13.4 output rules records that mutating task
  commands return post-write `state`/`done`/`total` and a conditional `next`;
  `CHANGELOG.md` `[Unreleased]` gains an `Added` entry for the additive output
  fields; `AGENTS.md` command table is left unchanged after confirming the
  suite list does not mention `task check`.
- T4: implement-skill step 6 says to announce `state: ready_to_complete` in the
  same turn, state that the planlet is ready for the separate completion
  workflow, and not archive it there; `tests/fixtures/skills/scenarios.json`
  gains a scenario whose evidence includes that wording and the
  `tests/skills/skill-contract.test.ts` expected-ID list is updated;
  `node dist/planlet.mjs update --tools all` regenerates byte-identical
  `.claude/skills`/`.agents/skills` copies that are committed; skill contract
  and workflow tests pass.

## Verification

Run the full suite gate from AGENTS.md in order: `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`,
`npm test`, `git diff --check`, then `git status --porcelain` clean (build
output is gitignored). Skill parity is verified by regenerating with
`node dist/planlet.mjs update --tools all` and by the byte-identical-copies
contract test. No `## Verification Evidence` section is expected: routine
results live in tests, review, and CI.

## Risks and Considerations

- Published CLI output surface: the addition is additive only, so no consumer
  breaks; `--json`/`schemaVersion` detection stays deferred per the design doc,
  and this plan records the contract line in §13.4 instead.
- The `next` string reuses the existing error-path convention
  `planlet complete <slug>`.
- Skill regeneration rewrites tracked copies only; the installer-managed set
  (`planlet-*` plus manifest) is unchanged.

## Rejected Alternatives

- Git hooks (D3): do not survive a clone, require per-machine setup, and
  false-positive on legitimate WIP pushes.
- Foreign-repo doc writing (D4): breaks the installer's managed-set safety
  model and creates surprise diffs and merge conflicts; not added even as
  opt-in in this plan.
- `planlet-implement` auto-archiving (D2): a lifecycle-design change; boundary
  kept, `planlet-complete` remains the only archiver.
- Hints on read-only `status`/`tasks` (report option a2): lower leverage; the
  mutating command is the trigger point.

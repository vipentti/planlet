# Implementation Guidance

## Validate the target manually when needed

Use this narrow fallback only for CLI operations that are unavailable:

- Accept slugs matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` and resolve them only as direct children of `<repository-root>/plans/`.
- Exclude `plans/completed/` from active selection.
- Require readable `plan.md` and `tasks.md`, each beginning with an H1.
- Recognize only top-level lines shaped as `- [ ] T<number> Description` or `- [x] T<number> Description` with non-empty descriptions.
- Refuse duplicate task IDs or malformed files. Do not interpret a missing or malformed checklist as zero remaining work.
- Report that the CLI could not provide canonical validation, status calculation, structured errors, or atomic task updates, as applicable.

Do not grow this fallback into a general Markdown parser.

## Evaluate drift

Repository change since planning is expected. Continue when current code merely changes incidental file locations or makes an equivalent implementation adjustment obvious. Explain the adjustment in the final summary.

Treat drift as material when it invalidates the stated approach, changes public behavior or acceptance criteria, introduces a migration or compatibility decision, removes an assumed dependency, or makes planned work harmful or redundant. Pause with concrete evidence and recommend a plan revision.

## Complete tasks truthfully

Before checking a task, confirm that its whole described outcome exists and that relevant verification passed. A code edit alone is not completion. Use targeted checks during implementation and broader checks when the plan or repository requires them.

If a check fails, distinguish an in-scope defect from unrelated existing failure. Fix in-scope defects when the plan authorizes it. Otherwise report the failing command and evidence, leave the task unchecked, and continue only when independent remaining work is safe.

For newly discovered necessary work, determine whether it is a small implementation detail or a material scope addition. Incorporate small details transparently. For material additions, propose consistent edits to both `plan.md` and `tasks.md`; preserve existing IDs and allocate new IDs above the highest current numeric suffix.

Use safe writes for fallback checkbox changes. Re-read immediately before editing, change one uniquely matching task ID, avoid rewriting unrelated Markdown, and verify the resulting task list afterward. If the file changed concurrently or the ID is missing or duplicated, stop without guessing.

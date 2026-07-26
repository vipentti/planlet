# Completion Guidance

## Validate the target manually when needed

Use manual behavior only for missing CLI operations:

- Accept a logical slug only when it matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and resolves to a direct child of `<repository-root>/plans/`.
- Exclude `plans/completed/` from active selection and keep every path inside the repository root.
- Require readable `plan.md` and `tasks.md`, each beginning with an H1.
- Recognize only top-level task lines shaped as `- [ ] T<number> Description` or `- [x] T<number> Description`. Require non-empty descriptions and unique IDs.
- Interpret malformed task-like lines as a structural error requiring review, not as completed or ignorable work.
- Inspect every entry in `plans/completed/` that has a valid real `YYYY-MM-DD-<slug>` archive name. Refuse completion if any parsed logical slug equals the target, even when its date differs.

Do not turn the fallback into a general parser or use it when the corresponding CLI operation exists.

CLI support is operation-specific. Missing `show` permits direct reads; missing `tasks` permits remaining-task inspection from already validated recognized lines; missing `validate` permits narrow structural validation; missing `complete` permits manual audit and movement. A supported operation returning a non-zero exit is a workflow failure, not evidence that operation is unavailable.

## Require explicit incomplete approval

List each remaining task ID and description before asking. Explain that an override moves the planlet while retaining unchecked tasks. Require an explicit confirmation directed at this planlet and a non-empty reason suitable for the audit trail. If either is absent, stop without editing.

Use reason exactly as approved except necessary surrounding-whitespace trimming. Never invent, generalize, or reuse reason from another planlet.

## Record one completion instant

Capture one current UTC timestamp in ISO 8601 form with a `Z` suffix, such as `2026-07-22T12:34:56Z`. Derive `YYYY-MM-DD` from that exact value. Do not read the clock again for archive naming.

Append one completion section to `tasks.md`:

```markdown
## Completion

- Completed at: <captured UTC timestamp>
- Mode: normal
```

For an approved override, use:

```markdown
## Completion

- Completed at: <captured UTC timestamp>
- Mode: incomplete override
- Remaining tasks: T2, T4
- Reason: <user-approved reason>
```

Refuse a pre-existing or conflicting completion record rather than silently rewriting history.

## Move safely

Before writing, verify that `plans/completed/` is inside the repository and that neither a logical-slug conflict nor `plans/completed/<YYYY-MM-DD>-<slug>` exists. Write the completion record safely and re-read it. Recheck the destination immediately before a plain filesystem move of the entire source directory.

If writing the record succeeds but movement fails, leave the source recoverable, do not copy or delete around the failure, and report that the completion record remains in the active planlet. Never merge with or replace an existing archive.

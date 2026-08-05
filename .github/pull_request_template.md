<!--
Keep the description proportional to the change.
Remove sections or fields that do not apply.
-->

## Summary

<!-- What changed, and why? Prefer 1–4 concrete bullets. -->

-

## CLI behavior

<!--
Remove this section when the change has no user-visible CLI effect.

Describe behavior reviewers cannot reliably infer from the diff:
- affected commands, options, or configuration
- stdout/stderr or structured output changes
- exit-code or error-code changes
- compatibility or migration considerations

Include a short before/after example when useful.
-->

- Commands/options:
- Output or errors:
- Compatibility:

## Implementation notes

<!--
Optional. Record important decisions, trade-offs, or deliberately excluded scope.
Do not narrate code that is already clear from the diff.
-->

-

## Verification

<!-- List the checks actually run. Do not check commands that were not run. -->

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run type-check`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `git diff --check`
- [ ] Targeted or manual CLI verification: <!-- command/result, or N/A -->

## Contributor checklist

- [ ] Tests cover new or changed behavior, or no test change is needed.
- [ ] User-facing documentation and CLI help are updated, or no update is needed.
- [ ] User-visible changes are recorded under `CHANGELOG.md` → `Unreleased`, or no changelog entry is needed.
- [ ] Every planlet task this PR completes is checked with `planlet task check <slug> <task-id>`, and a plan whose last task this PR completes is closed with `planlet complete <slug>`; or the PR completes no planlet task.
- [ ] Canonical skill changes have been regenerated with `node dist/planlet.mjs update --tools all`, or no skill changed.
- [ ] The change preserves supported Node.js and operating-system compatibility.

## Related work

<!-- Examples: Closes #123, Relates to #123, or plans/<slug>/. Remove if none. -->

-

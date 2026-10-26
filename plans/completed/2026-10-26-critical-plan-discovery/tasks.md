# Tasks: Critical Plan Discovery

- [x] T1 Rework `planlet-plan` discovery wording in `SKILL.md`, and planning guidance only if needed.
- [x] T2 Align `planlet_design.md` where it is now inconsistent with the new discovery behavior.
- [x] T3 Recheck S1-S3 and add the two new planning scenarios in `evaluations/skills/scenarios.md`.
- [x] T4 Update the scenario fixture and contract tests to track the new wording and scenarios.
- [x] T5 Build the CLI and regenerate tracked installed skill copies and manifests.
  - Verify: `node dist/planlet.mjs --root . tools` reports every destination `installed`.
- [x] T6 Add the `[Unreleased]` changelog entry for the published-skill behavior change.
- [x] T7 Run the manual behavior scenarios defined in `plan.md` Verification and record their outcome.
- [x] T8 Run the full repository verification suite defined in `plan.md`.

## Verification Evidence

- 2026-10-26 manual runs, Claude Code headless with Sonnet 5.5, disposable Node CLI fixture with the planlet-plan skill installed; one run per case, so results are indicative, not statistical.
- S2 precise request: no questions; persisted directly; brief report with stated minor assumptions. Pass.
- S12 contradicted premise: located the per-category re-read, challenged the Redis premise with evidence, asked before writing; after acceptance planned the single-pass fix. Mandated variant planned Redis and stated the objection once. Pass.
- S13 recommendation-led: one batch with recommendations, "all as suggested" persisted without further questions. Pass.
- S13 variant, first run: user override and agent assumptions labelled, but an unanswered side suggestion was persisted as plain scope. The assumption bullet was tightened to cover unanswered side suggestions; the rerun put confirmed decisions and unconfirmed items in separate labelled lists. Pass after fix.
- S1 staged answers: a scope-changing answer made the agent hold and re-ask the dependent format, category, and date questions before persisting; plan separates confirmed decisions from assumptions. Pass.

## Completion

- Completed at: 2026-10-26T15:28:57.410Z
- Mode: normal

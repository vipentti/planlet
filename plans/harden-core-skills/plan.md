# Harden Core Skills

## Summary

Complete Phase 2 by hardening canonical Planlet skills against implemented Phase 1 CLI contract, finalizing templates, minimizing manual fallback behavior, and adding repeatable skill evaluations.

## Motivation

Bootstrap skills predate CLI core. They describe operations abstractly and retain broad manual mechanics. Phase 2 should make CLI delegation precise, keep fallback narrow, and prove workflows through contract tests and scenario evaluations before harness installation work begins.

## Scope

- Harden canonical `planlet-plan`, `planlet-implement`, and `planlet-complete` skills under `skills/`.
- Define exact use of implemented CLI commands, global options, structured failures, target selection, and post-operation inspection.
- Use CLI behavior per available operation; invoke manual fallback only for missing operations.
- Finalize planning guidance and plan/task templates against `planlet_design.md`.
- Add deterministic skill-contract tests and CLI-backed workflow fixtures.
- Add provider-neutral scenario evaluations covering planning, revision, implementation drift, verification failure, target ambiguity, and incomplete completion.
- Synchronize canonical changes into existing `.agents/skills/` and `.claude/skills/` bootstrap copies and verify parity.

## Out of Scope

- `planlet init`, `update`, or `tools`.
- Permanent harness adapter architecture, generated-file protection, or new harness destinations.
- npm publishing, release automation, or bundled skill installation.
- CLI feature or output-format changes.
- Automated model-provider integration for semantic skill grading.
- Product changes unrelated to skill hardening.

## Approach

Treat `skills/` as authoritative. Update each workflow around one resolved CLI invocation and explicit repository root.

Planning will use list/create/validate operations, preserve confirmation boundary, populate only CLI-created stubs, and validate final files. Implementation will use validate/show/tasks/task-check/status operations, check tasks only after verification, and leave failed work unchecked. Completion will use validate/remaining-task inspection/complete operations, requiring explicit confirmation and reason before incomplete override.

Keep CLI parsing and lifecycle mechanics out of skills. Manual behavior remains operation-specific fallback for unavailable CLI capabilities, with explicit disclosure of missing deterministic checks.

Finalize templates around Summary, Scope, Approach, Acceptance Criteria, and Verification. Keep task syntax narrow and stable.

Add TypeScript contract tests for skill metadata, referenced resources, templates, supported command forms, fallback boundaries, and synchronized-copy parity. Exercise command examples against disposable repositories where useful.

Add scenario fixtures and rubrics for cases listed in `planlet_design.md` §20.3. Run and report provider-neutral dry-run evaluations. Cross-harness installation testing remains Phase 3; Phase 2 verifies canonical behavior and current bootstrap-copy parity.

## Acceptance Criteria

- All three canonical skills delegate every implemented deterministic operation to CLI.
- CLI examples use supported commands, flags, root handling, and non-interactive behavior.
- Planning never writes before explicit confirmation and validates populated files afterward.
- Implementation checks tasks only after relevant verification succeeds.
- Completion never archives incomplete work without planlet-specific confirmation and non-empty reason.
- Partial CLI availability triggers fallback only for missing operation, not entire workflow.
- Fallback text contains minimum safety behavior and identifies unavailable deterministic checks.
- Templates match file contract and produce valid headings and recognized task syntax.
- Scenario suite covers vague and precise planning, declined persistence, consistent revision, plan drift, failed verification, multiple active targets, incomplete completion, and portable canonical behavior.
- Canonical resources and existing `.agents/` and `.claude/` copies remain identical after synchronization.
- Full repository verification passes.

## Verification

Run skill-contract and CLI-backed scenario tests, synchronize bootstrap copies, and compare canonical/generated trees. Then run:

- `npm run format:check`
- `npm run lint`
- `npm run type-check`
- `npm run build`
- `npm test`
- `git diff --check`
- `git status --porcelain`

Inspect final Markdown diffs for valid headings, task syntax, broken links, and unintended content.

## Risks and Considerations

- Skills can become brittle if coupled to incidental TOON formatting. Depend on command contract, exit status, stable codes, and required fields only.
- Manual scenario grading is less reproducible than model-backed evaluation. Store explicit inputs and expected decisions so future automation can reuse them.
- Bootstrap synchronization replaces `planlet-*` generated copies. Canonical `skills/` remains sole source.

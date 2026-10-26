# Tasks: Critical Plan Discovery

- [ ] T1 Rework `planlet-plan` discovery wording in `SKILL.md`, and planning guidance only if needed.
- [ ] T2 Align `planlet_design.md` where it is now inconsistent with the new discovery behavior.
- [ ] T3 Recheck S1-S3 and add the two new planning scenarios in `evaluations/skills/scenarios.md`.
- [ ] T4 Update the scenario fixture and contract tests to track the new wording and scenarios.
- [ ] T5 Build the CLI and regenerate tracked installed skill copies and manifests.
  - Verify: `node dist/planlet.mjs --root . tools` reports every destination `installed`.
- [ ] T6 Add the `[Unreleased]` changelog entry for the published-skill behavior change.
- [ ] T7 Run the manual behavior scenarios defined in `plan.md` Verification and record their outcome.
- [ ] T8 Run the full repository verification suite defined in `plan.md`.

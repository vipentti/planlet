# Tasks: Task ID Normalization

- [ ] T1 Rewrite `planlet-plan` revision guidance and Finish report for boundary-based normalization.
- [ ] T2 Align `planlet-implement` material-addition guidance with the same rules.
- [ ] T3 Align `planlet_design.md` §8.2, §10, §19 and `AGENTS.md`, including the enforcement split.
- [ ] T4 Update skill scenarios, the scenario fixture, and the contract-test scenario list for the coverage in `plan.md`.
  - Verify: run the `planlet-plan` and `planlet-implement` normalization scenarios manually on disposable fixtures as `plan.md` describes.
- [ ] T5 Build the CLI and regenerate tracked installed skill copies and manifests.
  - Verify: `node dist/planlet.mjs --root . tools` reports every destination `installed`.
- [ ] T6 Add the `[Unreleased]` changelog entry for the published-skill behavior change.
- [ ] T7 Run the full repository verification suite defined in `plan.md`.

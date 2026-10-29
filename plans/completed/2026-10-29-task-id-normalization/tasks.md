# Tasks: Task ID Normalization

- [x] T1 Rewrite `planlet-plan` revision guidance and Finish report for boundary-based normalization.
- [x] T2 Align `planlet-implement` material-addition guidance with the same rules.
- [x] T3 Align `planlet_design.md` §8.2, §10, §19 and `AGENTS.md`, including the enforcement split.
- [x] T4 Update skill scenarios, the scenario fixture, and the contract-test scenario list for the coverage in `plan.md`.
- [x] T5 Build the CLI and regenerate tracked installed skill copies and manifests.
  - Verify: `node dist/planlet.mjs --root . tools` reports every destination `installed`.
  - Then run the manual normalization scenarios against the regenerated copies as `plan.md` describes.
- [x] T6 Add the `[Unreleased]` changelog entry for the published-skill behavior change.
- [x] T7 Run the full repository verification suite defined in `plan.md`.

## Verification Evidence

- Manual normalization scenarios S4, S14, S15 (base, move, and prerequisite variants), and S16 ran once with headless Claude Code against the regenerated installed skill copies on disposable fixtures; each matched its expected decisions and artifacts.
- After S14 changed to insert before `T1`, the revised S14 ran once with headless Claude Code against freshly regenerated installed skill copies on a disposable fixture: old `T1` became `T2`, `T10` stayed `T10`, and every reference named its original work.

## Completion

- Completed at: 2026-10-29T14:03:03.376Z
- Mode: normal

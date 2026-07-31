# Tasks: Verification Evidence Contract

- [x] T1 Make canonical planlet-plan guidance strategy-only with the no-log evidence policy
- [x] T2 Add optional concise verification-evidence maintenance to canonical planlet-implement
- [x] T3 Make canonical planlet-complete inspect and report optional evidence without parsing it
- [x] T4 Regenerate .agents and .claude skill copies with the built CLI and verify parity
- [x] T5 Cover opaque evidence notes in task parsing and in normal and incomplete completion
- [x] T6 Extend skill contract and scenario coverage for the evidence contract
- [x] T7 Record the contract in planlet_design.md, README.md, and AGENTS.md
- [x] T8 Run the full repository verification suite

## Verification Evidence

- 2026-07-31 local: `format:check`, `lint`, `type-check`, `build`, and `npm test` (142 passing)
  succeeded; `git diff --check` clean.
- 2026-07-31 parity: `node dist/planlet.mjs update --tools all` regenerated both destinations and
  `planlet tools` reports every destination `installed`; byte-identity tests pass.
- External: no CI run, PR, or release evidence applies to this change; none is claimed.

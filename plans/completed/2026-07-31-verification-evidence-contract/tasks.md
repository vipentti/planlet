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

- 2026-07-31 local @ `f04eb73`: `format:check`, `lint`, `type-check`, `build`, and `npm test`
  (142 passing) succeeded; `git diff --check` clean.
- 2026-07-31 parity: `node dist/planlet.mjs update --tools all` regenerated both destinations and
  `planlet tools` reports every destination `installed`; byte-identity tests pass.
- 2026-07-31 review @ `1fc58b1`: external review found that checkbox-shaped evidence bullets
  break the task parser; guidance, design, and parser coverage were corrected, and `npm test`
  passes at 143. Full suite rerun locally at this head.
- External: CI green on <https://github.com/vipentti/planlet/pull/1>; no release or registry
  evidence applies to this change and none is claimed.

## Completion

- Completed at: 2026-07-31T05:36:36.692Z
- Mode: normal

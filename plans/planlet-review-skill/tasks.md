# Tasks: Planlet Review Skill

- [ ] T1 Scaffold canonical `skills/planlet-review/SKILL.md` refined from the draft to match `planlet-plan` conventions and `skills/planlet-review/agents/openai.yaml` harness metadata; no CLI command or parser change
- [ ] T2 Create `skills/planlet-review/references/review-guidance.md` with review setup and the nine review checks plus severity and discipline notes, and wire progressive disclosure links from `SKILL.md`
- [ ] T3 Verify discoverability and harness integration is filesystem driven: `enumerateCanonicalSkills` needs no code change, `planlet init`/`update`/`tools` copy and report the new skill, and any hardcoded three-skill enumerations are updated only in docs and tests
- [ ] T4 Update skill tests and add a fixture-based read-only review check: extend `tests/skills/skill-contract.test.ts`, `tests/unit/skill-source.test.ts`, `tests/integration/packaging.test.ts`, and `tests/fixtures/skills/scenarios.json` for four skills, and validate verdict and finding format against sample planlets without mutation
- [ ] T5 Update docs for the four-skill lifecycle: `README.md`, `planlet_design.md`, and `CHANGELOG.md` `[Unreleased]` Added entry; verify `npm pack` includes the new skill and installed copies are byte-identical after `planlet update`

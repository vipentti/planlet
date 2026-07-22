# Tasks: Bootstrap Planlet Skills

- [ ] T1 Define the shared workflow conventions for target selection, file re-reading, CLI detection, fallback disclosure, confirmations, blockers, and final summaries.
- [ ] T2 Initialize the canonical `planlet-plan`, `planlet-implement`, and `planlet-complete` skill directories with valid Agent Skills frontmatter and only the resource directories each skill needs.
- [ ] T3 Create the reusable `plan.md` and `tasks.md` assets and document how planning turns scope and acceptance criteria into stable, verifiable tasks.
- [ ] T4 Implement `planlet-plan` and its planning guidance, including repository investigation, focused clarification, proposal review, confirmation before persistence, and consistent revision of both files.
- [ ] T5 Implement `planlet-implement` and its implementation guidance, including exact target selection, current-code inspection, plan-drift handling, incremental verified task updates, and scoped pause conditions.
- [ ] T6 Implement `planlet-complete` and its completion guidance, including structural checks, remaining-task reporting, explicit incomplete-override confirmation, UTC completion recording, date-prefixed archive naming, logical-slug and destination collision refusal, and safe movement.
- [ ] T7 Add and verify the narrow CLI-unavailable paths for manual creation, validation, progress updates, and UTC-dated completion while keeping CLI delegation as the preferred behavior.
- [ ] T8 Validate all skill folders, frontmatter, referenced paths, templates, naming, concision, and absence of generated placeholders or unnecessary documentation.
- [ ] T9 Add scenario evaluations covering vague and precise plans, declined persistence, revision, multiple active planlets, repository drift, failed verification, normal date-prefixed completion, logical-slug and destination collisions, and incomplete completion override.
- [ ] T10 Forward-test the skills with fresh agent context where practical, review raw artifacts and diffs, and revise instructions that produce unsafe, ambiguous, or overly ceremonial behavior.
- [ ] T11 Review the finished skills against `planlet_design.md` and the external-inspiration boundary, confirming Planlet-specific behavior and independently written instructions.
- [ ] T12 Dogfood the bootstrap workflow on this planlet, keep its checkboxes current during implementation, and report any design changes that should feed into the CLI planlet.

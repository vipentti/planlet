# Tasks: Archive Link Rewrite With a Markdown Parser

- [x] T1 Add the pinned parser devDependencies and the pure `link-rewrite.ts` module with the unit test matrix.
  - Verify: `npx tsx --test tests/unit/link-rewrite.test.ts` and `npm run knip`.
- [x] T2 Wire the rewrite into fresh and resume completion with atomic publishes, warnings, and integration tests.
  - Verify: `npx tsx --test tests/integration/completion.test.ts`.
- [x] T3 Make the complete skill report completion warnings, add its contract assertion, and regenerate installed skill copies.
  - Verify: `node dist/planlet.mjs update`, then `node dist/planlet.mjs --root . tools` reports every destination installed.
- [x] T4 Update `planlet_design.md` (step 9, dependency exception), `README.md`, and the `[Unreleased]` changelog entry.
- [x] T5 Run the full repository verification suite defined in `plan.md`.

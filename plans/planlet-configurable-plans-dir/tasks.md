# Tasks: Configurable Plans Directory

- [x] T1 Add `.planlet.json` parser, plans-dir resolver, leftover `plans/`
      guard, and `invalid_config` / `plans_dir_conflict` error codes.
      Verify: unit tests for absent file, unknown keys, reserved names,
      invalid JSON, `..`, leftover vs empty `plans/`.
- [x] T2 Wire the resolver through readers, writers, create, task update,
      complete, link-rewrite prefixes, init mkdir, and both completion-gate
      functions. Verify: default-path suite still passes; gate extracts
      slugs for `docs/plans`.
- [x] T3 Add `init --plans-dir`, snippet default-plus-file wording,
      `plansDir` on list and dashboard, and the configured archive path in
      the date-prefix slug error. Verify: `init --plans-dir plans` writes no
      file; snippet tests and list fixtures include `plansDir`.
- [x] T4 Cover the two-segment lifecycle, missing configured directory,
      leftover-`plans/` gate failure, and YAML/invalid-path fail-closed
      cases. Verify: create, task check, complete, and link rewrite under
      `docs/plans`; gate ok vs `plans_dir_conflict`.
- [x] T5 Update `planlet_design.md` §9 and §9.1, README layout and CI,
      CHANGELOG `[Unreleased]`, and regenerate the agent section if snippet
      bytes changed. Verify: referenced paths exist; `format:check`; no
      `.planlet.json` in this repository.

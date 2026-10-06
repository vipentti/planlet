# Planlet Review Skill

## Summary

Add a new read-only `planlet-review` skill under `skills/planlet-review/` that reviews exactly one active planlet as an implementation handoff without editing files, updating task state, completing the planlet, or implementing changes. The skill refines the provided draft into the repository's canonical skill conventions (frontmatter, progressive disclosure, read-only CLI usage) and is the only change in scope. No CLI command, core parser, or execution model change.

## Scope

In scope:

- Canonical skill directory `skills/planlet-review/` with `SKILL.md` refined from the provided draft to match `skills/planlet-plan/SKILL.md` structure and conventions: frontmatter (`name`, `description`, `allowed-tools: Bash(planlet:*)`, `compatibility: Requires planlet CLI.`, `license: MIT`), workflow sections (`Start the workflow`, review setup, review checks, findings, output), and progressive disclosure links to references.
- Discoverability and integration: how the skill is surfaced to agents. Enumerate canonical skills dynamically via `src/core/harness/skill-source.ts` so no registry code change is expected, but update any docs or tests that enumerate skills by name, and verify `planlet init`/`planlet update`/`planlet tools` copy and report the new skill.
- Assets and references the skill needs: at minimum `references/review-guidance.md` (checklist and defect taxonomy for the nine review dimensions) and optionally `agents/openai.yaml`; wire them from `SKILL.md` with relative links. No extra binaries or scripts.
- Tests: extend or add coverage that the existing skill tests exercise (contract checks, harness installer expectations, packaging tarball contents, scenario fixtures) plus a fixture-based read-only check with a sample planlet that yields expected verdict and finding format.
- Docs: update `README.md` skill-first flow and any design doc section that lists skills, and add a `CHANGELOG.md` `[Unreleased]` entry. Skill sources under `skills/` remain canonical; installed copies under `.agents/skills/` and `.claude/skills/` are regenerated via `planlet update`.

Out of scope:

- No CLI command (`planlet review` or similar). The skill uses only existing read-only commands (`list`, `validate`, `show --part plan|tasks`, `status`, `tasks`, and inspection of repository state).
- No core parser or planlet file-contract change (`src/core/plan/` validation, task-parser, completion, status).
- No change to the lifecycle execution model (create, task check, complete behaviors, locking).

## Approach

Ground implementation in the existing skill corpus and the provided draft without redesign:

- Inspect `skills/planlet-plan/`, `skills/planlet-implement/`, `skills/planlet-complete/` for file layout, frontmatter, `allowed-tools` scoping, `The planlet CLI is required` stop condition, shell escaping note, reference phrasing, and install guidance. Model `planlet-review` directly on `planlet-plan` structure: keep the skill short and move detail to `references/`.
- Refine `SKILL.md` from the draft: preserve read-only intent, the fresh-agent test, plan plus tasks as one handoff, nine review checks, BLOCKER versus IMPORTANT severity, and the strict output shape (verdict READY or NEEDS REVISION, `Reviewed: <slug> @ <commit-sha>`, requested revisions in `[SEVERITY] location - problem. Why: impact. Fix: minimal change.` form, completion marker `Review ready`). Normalize wording to repository style, remove any CLI or parser scope, keep verification proportional, and forbid editing state.
- Create `references/review-guidance.md` covering review setup (resolve repo root, exactly one active planlet, `planlet validate <slug>` as defect if non-zero, full read of `plan.md` and `tasks.md`, inspection of repository instructions and relevant code/tests/config) and the nine checks: outcome and scope, repository grounding, acceptance criteria, verification, plan-task coverage, task readiness, concision and ownership, ordering, drift. Keep discipline notes (evidence based, minimal, no redesign, no duplicate findings).
- Add `agents/openai.yaml` matching the other skills (`display_name`, `short_description`, `default_prompt` pointing to `$planlet-review`).
- Discoverability: confirm `enumerateCanonicalSkills` and `resolveCanonicalSkillsPath` need no code change (they discover any `planlet-*` directory). Verify `HARNESS_ADAPTERS` and installer (`src/core/harness/`) already copy unknown skills via the same path. Update documentation surfaces only: `README.md` skill count and lifecycle list, `planlet_design.md` section 14 skills tree and skill descriptions. Update tests that hardcode skill names rather than adding registry code.
- Tests: update `tests/skills/skill-contract.test.ts` (add `planlet-review` to `SKILL_NAMES`, assert frontmatter and read-only CLI forms, assert no `planlet task check` or `complete` in this skill, assert evidence handling matches read-only role), `tests/unit/skill-source.test.ts` (expected sorted skill list), `tests/integration/packaging.test.ts` (expected tarball entry), and `tests/fixtures/skills/scenarios.json` if a review scenario is added. Add a fixture-based check that runs the review logic against a sample valid and a sample defective planlet and asserts verdict and finding format without touching the sample. Keep skill workflow tests read-only.
- Docs and packaging: update `README.md` to list four skills and describe the review handoff, ensure `CHANGELOG.md` carries an Added entry under `[Unreleased]`, and verify `npm pack` includes `skills/planlet-review/**` and that `planlet update --tools all` regenerates byte-identical copies under `.agents/skills/planlet-review/` and `.claude/skills/planlet-review/`.

Ordering: T1 (scaffold) before T2 (references) before T3 (docs integration) and T4 (tests). T5 closes with full suite verification. Each task is independently reviewable after its files land.

## Acceptance Criteria

- `skills/planlet-review/SKILL.md` exists with frontmatter `name: planlet-review`, a discoverable `description` for the read-only review handoff, `allowed-tools: Bash(planlet:*)`, `compatibility: Requires planlet CLI.`, `license: MIT`, and body structured like `planlet-plan` with progressive disclosure links to references and no CLI or parser change language. It encodes the draft: read-only, exactly one active planlet, `planlet validate` as gate, nine review checks, BLOCKER and IMPORTANT only, verdict plus `Reviewed: <slug> @ <commit-sha>` plus requested revisions format plus `Review ready`, and rules for READY, no edits, and proportional verification.
- `skills/planlet-review/references/review-guidance.md` exists and is linked from `SKILL.md`; it contains the nine checks, severity definitions, defect test, and discipline notes without duplicating full plan details. `skills/planlet-review/agents/openai.yaml` exists with harness metadata matching sibling skills.
- Discoverability verified: `enumerateCanonicalSkills` lists `planlet-review` without code change, `planlet tools` reports it, and `planlet init` and `planlet update` install it to both `.agents/skills/planlet-review/` and `.claude/skills/planlet-review/` byte-identical to `skills/planlet-review/`. No new CLI command or core parser file was changed.
- Tests updated and green: `tests/skills/skill-contract.test.ts`, `tests/unit/skill-source.test.ts`, `tests/integration/packaging.test.ts`, and `tests/fixtures/skills/scenarios.json` reflect four skills where appropriate, and a new or extended fixture-based test validates read-only review verdict and finding format against sample planlets without mutating them.
- Docs updated and green: `README.md` lists four skills and describes the review handoff without inventing commands; `planlet_design.md` skills tree and sections include `planlet-review`; `CHANGELOG.md` `[Unreleased]` has an Added entry for the skill; `npm pack` tarball contains the new skill and suite `npm run format:check`, `npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`, `npm test`, `git diff --check` all pass.

## Verification

Strategy only, run after each task and again before PR; regular results stay in test and CI history:

- `planlet --root . validate planlet-review-skill` for this plan itself, and `planlet --root . validate --all` after adding the new skill directory to catch file-contract regressions.
- `npm run format:check` (markdown and code style, including `SKILL.md` and reference markdown), `npm run lint`, `npm run knip` (no orphaned imports after doc or test updates), `npm run type-check`, `npm run build` (`dist/planlet.mjs` builds and still resolves canonical skills from both `src/` and `dist/` locations).
- `npm test` including `tests/skills/skill-contract.test.ts`, `tests/unit/skill-source.test.ts`, `tests/integration/packaging.test.ts`, and any new fixture test; verify `skill-source` and harness installer tests still pass with four skills.
- `npm pack --json --pack-destination /tmp` and inspect file list for `skills/planlet-review/SKILL.md` and its references; run `node dist/planlet.mjs --root /tmp/repo init` and `update` in a scratch repo and diff `.agents/skills/planlet-review/` and `.claude/skills/planlet-review/` against `skills/planlet-review/`.
- Manual review: `planlet --root . list` and `planlet --root . tools` show four skills, `README.md` and `planlet_design.md` diffs contain only intended lines, and `CHANGELOG.md` diff is a single Added entry.

No `## Verification Evidence` section is planned for this plan itself; all checks are reproducible locally and in CI.

## Risks and Considerations

- Hardcoded skill lists: several tests and docs enumerate three skills by name; missing one enumeration will cause a narrow test failure. Mitigate by searching for `planlet-plan`, `planlet-implement`, `planlet-complete` and `SKILL_NAMES` before closing T4.
- Draft-to-convention drift: the draft is concise but not in `planlet-plan` phrasing. Refinement must keep read-only and output-shape guarantees verbatim while adopting the shared `The planlet CLI is required`, shell escaping, and progressive disclosure style. Review guidance should hold detail so `SKILL.md` stays short.
- Scope creep via CLI or parser: explicitly forbid a `planlet review` command or parser grammar change even if a reviewer suggests it; the plan is skill-only.
- Reference asset scope: keep `review-guidance.md` focused to the nine checks and severity taxonomy; do not add templates or scripts that would imply a new CLI surface.

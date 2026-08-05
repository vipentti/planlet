# Skill Frontmatter

## Summary

Add three standard Agent Skills frontmatter fields —
`allowed-tools: Bash(planlet:*)`, `compatibility: Requires planlet CLI.`, and
`license: MIT` — to all three canonical planlet skills (`planlet-plan`,
`planlet-implement`, `planlet-complete`), then regenerate the tracked installed
copies and manifests. `allowed-tools` pre-approves literal `planlet` commands
for the invoking turn in Claude Code, removing per-command permission prompts;
`compatibility` and `license` are standard metadata with no host enforcement
today.

## Scope

In scope:

- Frontmatter of `skills/planlet-plan/SKILL.md`,
  `skills/planlet-implement/SKILL.md`, and
  `skills/planlet-complete/SKILL.md`: three fields inserted after
  `description`, keeping `name` first.
- Relaxed contract-test assertion at `tests/skills/skill-contract.test.ts:32`.
- Regenerated `.agents/skills/` and `.claude/skills/` copies plus both
  `.planlet-manifest.json` digest sets.
- `CHANGELOG.md` `[Unreleased]` entry.
- Optional: one sentence in `planlet_design.md` section 14 noting the optional
  `allowed-tools` field.

Out of scope:

- `skills/*/agents/openai.yaml` — untouched by SKILL.md frontmatter.
- CLI frontmatter parsing or schema validation; `metadata` fields; harness
  adapters; `.github/skills` copies.
- New modules, new dependencies, or CLI changes.

## Approach

Follow the scout-report sketch (field analysis, consumers, and cost in
sections 2–5):

1. Edit the three canonical `SKILL.md` frontmatter blocks to the target shape.
   Fields stay within the standard six Agent Skills top-level fields, so
   `skills-ref` validation still passes:

   ```yaml
   ---
   name: planlet-plan
   description: Explore, propose, create, or revise one repository-local Planlet without implementing product changes. Use when ...
   allowed-tools: Bash(planlet:*)
   compatibility: Requires planlet CLI.
   license: MIT
   ---
   ```

   Same shape for `planlet-implement` and `planlet-complete`, with each skill's
   own `name` and `description` unchanged.
2. Relax `tests/skills/skill-contract.test.ts:32` to
   `assert.match(markdown, /\ndescription: \S.+/);`. Keep the `name`-first
   assertion at line 31 unchanged. Report section 4 item 1 confirms this is the
   only test the new fields trip; `scenarios.json` and evaluations contain no
   frontmatter references.
3. Regenerate installed copies and manifests: `npm run build`, then
   `node dist/planlet.mjs --root . update --tools all`. Deterministic digest
   churn in both manifests is expected (report section 4 item 2) and committed
   per AGENTS.md.
4. Add the `CHANGELOG.md` `[Unreleased]` entry (skill behavior is user-visible
   product surface; precedent #37). Optionally add the design-doc sentence.

## Acceptance Criteria

- All three canonical `skills/*/SKILL.md` files carry exactly `name` first,
  `description` second, then `allowed-tools: Bash(planlet:*)`,
  `compatibility: Requires planlet CLI.`, and `license: MIT`, before the
  closing `---`.
- No other frontmatter fields; `agents/openai.yaml` files and skill bodies are
  byte-unchanged.
- `.agents/skills/` and `.claude/skills/` copies are byte-identical to the
  canonical files; both `.planlet-manifest.json` digest sets match.
- Contract test accepts fields after `description`; `name`-first assertion
  unchanged.
- `tests/fixtures/skills/scenarios.json` and `evaluations/` unchanged.
- `CHANGELOG.md` `[Unreleased]` entry present.
- Full suite green: `npm run format:check`, `npm run lint`, `npm run knip`,
  `npm run type-check`, `npm run build`, `npm test`, `git diff --check`.

## Verification

Strategy only; results stay in the suite and CI:

- Structural check of the three frontmatter blocks after the edit (field names,
  order, closing delimiter).
- Byte-identity of installed copies is enforced by `npm test`
  (`tests/skills/skill-contract.test.ts`).
- Regeneration is idempotent: `node dist/planlet.mjs --root . update --tools all`
  and `node dist/planlet.mjs --root . tools` report every destination
  installed.
- Full suite per AGENTS.md, run after all changes. Expected diff: 3 canonical
  SKILL.md files, 6 installed copies, 2 manifests, 1 test line, changelog, and
  optional design-doc line.
- No `## Verification Evidence` note expected; no durable fact outside ordinary
  history.

## Risks and Considerations

- `Bash(planlet:*)` matches literal `planlet ...` commands only; `npm install
  -g @vipentti/planlet` and `npx @vipentti/planlet` invocations still prompt in
  Claude Code. The grant pre-approves, never restricts, and is inert in Codex
  and unknown generic clients (report section 2).
- `compatibility` and `license` are documentation-only today; no host reads
  them back.
- Field order is contract-tested; `name` must remain first.

# Copilot Adapter

## Summary

Register `github-copilot` as an explicit harness adapter sharing the existing
`.agents/skills` destination with `agents` and `codex`, same pattern as `codex`.
Real Copilot CLI 1.0.78 already discovers and invokes the three planlet skills
from `.agents/skills` (verify report, 2026-08-05); the adapter adds an explicit
`--tools github-copilot` selector, accurate help/docs, and `planlet tools`
reporting.

## Scope

- `src/core/harnesses.ts`: add adapter entry `{ id: "github-copilot",
  displayName: "GitHub Copilot", skillDirectory: ".agents/skills" }`.
- Adapter-enumerating surfaces: `src/cli.ts` init/update help text; interactive
  `init` tool selector (verify registry-driven behavior); README harness table
  and `--tools` text; `planlet_design.md` §15.2 registry table.
- Tests: `tests/unit/harnesses.test.ts`, `tests/unit/harness-installer.test.ts`
  detect expectations, `tests/integration/harness-installation.test.ts`,
  `tests/skills/skill-contract.test.ts`, `tests/fixtures/skills/scenarios.json`.
- `CHANGELOG.md` `[Unreleased]` Added entry; README documents the `.github/skills`
  shadowing gotcha.
- No skill-content changes (canonical skills are harness-neutral; verified by the
  Copilot verify report). No `.github/skills` destination. No manifest schema
  change (post-#41 manifests are schema v2, `{schemaVersion, files}` only, with
  no `tools` field to update). No new dependencies.

## Approach

- Add one entry to `HARNESS_ADAPTERS`. `normalizeToolSelector` and
  `resolveHarnessDestinations` are registry-driven: the new id is accepted
  automatically, `.agents/skills` coalesces with `agents`/`codex`, aliases
  become `["agents", "codex", "github-copilot"]`, and one physical install
  satisfies all three selectors.
- `detectHarnesses` and `planlet tools` gain a `github-copilot` entry
  automatically; its state mirrors the shared `.agents/skills` state.
- Interactive `init` selector (`buildToolChoices` in `src/cli.ts`) is
  registry-driven: the `.agents/skills` choice gains "GitHub Copilot" in its
  name list and selector `agents,codex,github-copilot`. No prompt-logic change
  expected; verify by test.
- `harness-installer.ts` transaction, lock, rollback, and manifest machinery is
  destination-based and unchanged. No installed-copy regeneration is needed
  because no skill files change and the manifest has no tool enumeration.
- Correct `planlet_design.md` §15.2: move `github-copilot` from "Likely later
  additions" (which listed `.github/skills`) into the main registry table with
  `.agents/skills`.
- README documents the verified shadowing gotcha: a duplicate `planlet-*` name
  in `.github/skills` shadows the `.agents/skills` copy in Copilot's listing;
  do not create a separate `.github/skills` copy.

## Acceptance Criteria

- `--tools github-copilot` is accepted; `--tools all` resolves four tool ids;
  `.agents/skills` destination aliases include `agents`, `codex`,
  `github-copilot`; no `.github/skills` destination appears in code, docs, or
  tests.
- `detectHarnesses` / `planlet tools` report `github-copilot` with the same
  state as `agents`/`codex` on the shared destination.
- CLI help, README, and design doc enumerate `github-copilot`; the interactive
  selector offers `.agents/skills` once under all three names.
- Tests updated for selector, alias, detect, prompt-choice, and portable-harness
  expectations; full repository suite green.
- `CHANGELOG.md` `[Unreleased]` has an Added entry; README documents the
  `.github/skills` shadowing gotcha.
- No skill bodies, manifest schema, or dependencies changed.

## Verification

- Full suite: `npm run format:check`, `npm run lint`, `npm run knip`,
  `npm run type-check`, `npm run build`, `npm test`, `git diff --check`, and
  clean porcelain (build output is gitignored).
- Structural checks: `node dist/planlet.mjs --root . tools` enumerates four
  adapters with `github-copilot` on `.agents/skills`; `init --tools
  github-copilot` and `init --tools all` install to `.agents/skills` and are
  idempotent; help text lists `github-copilot`; README and design-doc diffs
  contain only the intended changes.
- No `## Verification Evidence` note expected: every check is reproducible in
  the repository suite, review, and CI.

## Risks and Considerations

- `.github/skills` shadowing: a duplicate skill name there shadows the
  `.agents/skills` copy in Copilot's listing (verified with Copilot CLI 1.0.78).
  Mitigated by README documentation and by not adding a `.github/skills`
  destination.
- Existing installs are unaffected: same files, same destination, manifest v2
  unchanged; `planlet tools` simply reports one additional adapter.
- Copilot VS Code/JetBrains/cloud surfaces were not exercised locally; the
  verify report covers CLI 1.0.78 discovery and invocation. The adapter is a
  selector/reporting nicety, not a functional prerequisite.
- The design doc previously listed `github-copilot` → `.github/skills` as a
  likely later addition; correcting it to the shared path is in scope.

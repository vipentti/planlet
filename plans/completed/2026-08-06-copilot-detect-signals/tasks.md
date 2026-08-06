# Tasks: Copilot Detection Signals

- [x] T1 Define per-adapter repository marker registry and detector
  - Acceptance: registry covers `agents` `.agents/`; `claude`
    `.claude/skills`, `.claude/settings.json`, `.claude/settings.local.json`,
    `.claude/commands`; `codex`
    `.codex/`; and Copilot `.github/copilot-instructions.md`,
    `.github/instructions`, `.github/skills`, `.github/prompts`, and
    `.github/agents`.
  - Acceptance: detector reads repository-local paths only, treats expected
    file/directory kinds correctly, performs no writes or home/global probes,
    and ignores Planlet-only `planlet-*` skill directories plus
    `.planlet-manifest.json` under `.agents/skills` and `.claude/skills`.
  - Verification: focused unit tests cover every marker, absent and wrong-kind
    paths, empty directories, non-Planlet entries, and Planlet-only footprints.

- [x] T2 Apply per-harness signals to interactive init defaults
  - Acceptance: any detected adapter marker preselects its destination;
    agents, Codex, and Copilot markers select shared `.agents/skills`, while
    Claude markers select `.claude/skills`; mixed markers select each matching
    destination once.
  - Acceptance: no user markers preserve current fallback; Planlet-only
    destination content does not preselect a harness; `--tools all` and explicit
    `--tools github-copilot` remain unchanged; installer writes no `.github`
    mirror and keeps Copilot destination `.agents/skills`.
  - Acceptance: installation state and `planlet tools` output do not gain or
    reinterpret host-availability fields; required Unreleased changelog entry
    is present; README/help changes only if wording changes.
  - Verification: focused interactive-selector and CLI/integration tests pass.

- [x] T3 Complete regression coverage and suite gate
  - Acceptance: marker unit tests, mixed-selector tests, Planlet-footprint
    regressions, explicit-selector tests, and existing harness/installer/CLI
    tests pass; no new dependency or global detection path appears.
  - Acceptance: full gate passes: `npm run format:check`, `npm run lint`,
    `npm run knip`, `npm run type-check`, `npm run build`, `npm test`, and
    `git diff --check`.

## Completion

- Completed at: 2026-08-06T07:28:31.963Z
- Mode: normal

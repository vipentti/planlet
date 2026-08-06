# Copilot Detection Signals

## Summary

Make interactive `planlet init` detect repository-local harness markers for
every registered adapter and preselect each matching install destination.
Preserve current installation destinations, explicit selectors, and
non-interactive behavior. Exclude Planlet's own installed skill footprint from
user-harness detection.

## Scope

- Add explicit repo-local presence markers to every registered adapter:

  | Adapter | Known repository markers |
  | --- | --- |
  | `agents` | `.agents/` directory |
  | `claude` | `.claude/skills/`, `.claude/settings.json`, `.claude/settings.local.json`, `.claude/commands/` |
  | `codex` | `.codex/` directory |
  | `github-copilot` | `.github/copilot-instructions.md`, `.github/instructions/`, `.github/skills/`, `.github/prompts/`, `.github/agents/` |

- Treat file markers as exact existing files and directory markers as existing
  directories. Presence of any known marker signals its adapter; do not parse
  marker contents or scan unrelated repository paths.
- Keep Copilot marker list aligned with documented repository surfaces:
  [custom instructions](https://docs.github.com/en/copilot/reference/custom-instructions-support),
  [agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills),
  [prompt files](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide?tool=vscode),
  and [custom agents](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).
- Keep detection repository-local. Never probe `~/.copilot/`,
  `~/.agents/`, or other home/global paths. Do not use root `AGENTS.md` or
  `CLAUDE.md` as markers because Planlet may manage those files.
- Prevent circularity: `.agents/skills/planlet-*` and
  `.claude/skills/planlet-*`, plus their `.planlet-manifest.json`, do not signal
  `agents` or `claude` by themselves. For the `.agents/` marker, the enclosing
  directory is Planlet-only when its sole child is `skills` and that child
  contains only the recognized Planlet footprint. A marker directory containing
  only that footprint is not user evidence; an empty marker directory or any
  non-Planlet entry remains user evidence.
- Do not use bare `.claude/` as a marker. Planlet creates `.claude/skills`, so
  bare parent presence cannot distinguish user Claude use from Planlet's own
  footprint; apply same sole-child-skills exclusion logic used for `.agents/`.
- Use signals only for interactive init default preselection. Keep
  `agents`, `codex`, and `github-copilot` coalesced at `.agents/skills`; keep
  `claude` at `.claude/skills`.
- Keep `.agents/skills` as sole Copilot install destination. Never mirror
  skills into `.github/skills`.
- Leave `--tools all`, explicit `--tools github-copilot`, other explicit
  `--tools` selectors, installer state, and `planlet tools` behavior unchanged.
- Add focused tests and required Unreleased changelog entry. Change README or
  CLI help only if implementation changes a README/help line.
- Add no dependency.

## Approach

Extend harness adapter metadata in `src/core/harnesses.ts` with marker paths
and add one generic detector returning detected adapter IDs. Use bounded
`lstatSync` checks for marker kind. Apply the existing Planlet ownership
convention (`planlet-*` skill directories and `.planlet-manifest.json`) when
evaluating `.agents/` and `.claude/skills/`; for `.agents/`, inspect its
`skills` child only to recognize that Planlet-only shape. Planlet installation
cannot manufacture harness detection. Do not follow external symlinks as
repository markers.

Make `buildToolChoices` consume detected IDs. A destination is preselected when
its existing user marker or any alias has a detected marker. Therefore a
`.codex/` or Copilot `.github` marker selects shared `.agents/skills`, while a
Claude marker selects `.claude/skills`. Retain current all-choice fallback when
no user marker exists. Keep `detectHarnesses` state installation-only; marker
availability must not become `installed` or a new `planlet tools` field.

## Acceptance Criteria

- Detector defines and tests markers for all four adapters: `agents`, `claude`,
  `codex`, and `github-copilot`.
- Any existing known marker preselects its adapter's destination in interactive
  init: `.agents/` for agents, `.codex/` for Codex, `.github/*` Copilot markers
  for shared `.agents/skills`, and Claude markers for `.claude/skills`.
- A repository containing only Planlet-managed `planlet-*` directories and
  `.planlet-manifest.json` under `.agents/skills` or `.claude/skills` does not
  signal those harnesses. Non-Planlet user entries still signal them.
- Missing markers, wrong marker kinds, and no-user-marker repositories preserve
  current defaults; no home/global path is read.
- `--tools all` and explicit `--tools github-copilot` continue writing one
  `.agents/skills` tree; no `.github/skills` copy is created or updated.
- Harness installation state and `planlet tools` output remain unchanged by
  marker presence.
- Tests cover marker and selector behavior, and Unreleased changelog records
  interactive default change. README/help stays unchanged unless its wording
  changes.

## Verification

Run focused unit tests for every adapter marker and Planlet-footprint filtering.
Run integration tests for mixed marker sets, shared-destination preselection,
empty/no-marker fallback, explicit selectors, and non-interactive init. Confirm
existing harness, installer, and CLI tests stay green.

Run suite gate in order:

```sh
npm run format:check
npm run lint
npm run knip
npm run type-check
npm run build
npm test
git diff --check
```

Review diff for repo-local checks only, unchanged install destinations, no
`.github/skills` mirroring, no Planlet-footprint-only signal, and no new
dependency.

## Risks and Considerations

Folder presence can produce false positives, but explicit per-harness markers
make interactive defaults discoverable without content parsing. Planlet-owned
skill directories use reserved `planlet-*` names and a manifest; that ownership
rule must stay shared with installer conventions. A user skill using reserved
`planlet-*` naming is treated as Planlet footprint by design.

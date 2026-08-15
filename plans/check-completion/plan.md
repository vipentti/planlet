# Add read-only check-completion CI gate

## Summary

Add one read-only CLI command, `planlet check-completion --base <git-ref>`, that fails CI when a changeset touches an active Planlet whose canonical state is now `ready_to_complete` and that Planlet has not been archived. Callers that already ran `planlet complete <slug>` in the same changeset pass, because the active directory is gone. The command never completes, archives, edits, stages, or otherwise mutates anything.

## Scope

In scope:

- New command `planlet check-completion --base <git-ref> [--head <git-ref>]`.
- Required `--base` (branch, tag, or commit). Optional `--head`, default `HEAD`.
- Touched-slug detection from a git name-only diff of `plans/`, ignoring `plans/completed/**`.
- Violation only when a touched slug still exists as an active directory and `deriveLifecycleState` / `listPlanlets` reports `ready_to_complete`.
- Actionable TOON output naming each violating slug and `planlet complete <slug>`.
- Reuse existing git spawn helper in `src/core/git.ts` for a new read-only listing function. Reuse `listPlanlets` (active only) for state. No CLI-output parsing.
- User-visible docs: `README.md` command table (help-sync test), `planlet_design.md` §13.2 and a pointer in §8.5, `CHANGELOG.md` `[Unreleased]`.

Out of scope:

- Completing, archiving, editing, staging, locking, or any other mutation.
- GitHub Actions, reusable workflows, or any CI-provider adapter. Callers pass `--base` themselves.
- Generic CI/policy framework, extra policy checks, or auto-complete.
- Changing `complete`, status derivation, or agent skills / `AGENT_SNIPPET`.
- Working-tree-only uncommitted diffs as a substitute for the ref comparison.

## Approach

CLI wiring follows the existing split: `src/cli.ts` parses flags and help, `src/commands/check-completion.ts` is a thin `emit` handler, domain logic lives under `src/core/`. `runGitOutput` stays private; export one read-only helper such as `listDiffPaths(repositoryRoot, { range, pathspec })` that fails the command when git fails. Do not reuse `tryStage` warning-on-failure: this command's result is the git query.

Comparison is the three-dot range `<base>...<head>` scoped to `-- plans/` (merge-base to head). That is the PR changeset, not a full tree walk of the two tips. Rejected alternative: two-tree `git diff base head`, which also reports paths that only moved on the base side after the branch point. One `git diff --name-only <base>...<head> -- plans/` call is enough; pass refs as argv, never through a shell.

A path `plans/<segment>/...` contributes `<segment>` when `segment` is a valid slug and is not `completed`. Files directly under `plans/` and every path under `plans/completed/` are ignored. Sort slugs with `byName`.

`touched` is the subset of those slugs that `listPlanlets({ repositoryRoot })` still discovers as active. `violations` is the subset whose `state === "ready_to_complete"`. A slug completed in-range is absent from active storage, so it cannot violate. Invalid active planlets stay `invalid` and do not violate; their existing summary warnings may appear on stderr. State is read from the current working tree through the same loaders as `status` / `list`. The git range only answers "was this slug touched."

No planlet lock. Read-only commands do not take `withPlanletLock` today, and this command must not create a holder file.

Output uses the `validate` pattern: always write one TOON report on stdout when the check ran, then remap a non-empty `violations` list to `EXIT_CODES.stateTransition` (4). Success is exit 0 with `ok: true`. Include `ok`, `base`, `head`, `touched`, and `violations` (each violation: `slug` plus `next: "planlet complete <slug>"`). Empty `touched` is success, not an error.

Git and usage failures stay structured errors, not an `ok: false` report:

- Missing `--base`, empty `--base`, unexpected positionals, or unknown flags: existing usage exit 2.
- No git marker, unresolvable ref, missing merge-base, or other git failure: new `git_error` mapped to `EXIT_CODES.operational` (1).
- Missing `plans/`: existing `plans_not_initialized`.

The command is CI-provider-neutral: no `GITHUB_*` reads, no default of `origin/main`.

## Acceptance Criteria

- `planlet check-completion --base <ref>` is documented in help and the README command table, accepts optional `--head` defaulting to `HEAD`, and is registered beside the other non-mutating commands.
- The command is read-only: it does not write plan files, take a planlet lock, stage, commit, or invoke `completePlanlet`.
- Touched detection uses `git diff --name-only <base>...<head> -- plans/`, ignores `plans/completed/**`, and ignores invalid slug segments.
- A touched active planlet in `ready_to_complete` produces a stdout report with `ok: false`, that slug in `violations` with `next: "planlet complete <slug>"`, and exit 4.
- A planlet completed in the same range (active directory gone) does not violate, even though its old `plans/<slug>/` paths appear in the diff.
- Touched `draft` / `planned` / `in_progress` / `invalid` planlets do not violate. Untouched `ready_to_complete` planlets do not violate.
- State comes from `listPlanlets` / `deriveLifecycleState`, never from parsing `planlet status` output.
- Missing `--base` is usage 2. Git lookup failure is `git_error` on stderr and exit 1. No GitHub-specific environment or path behavior.

## Verification

Strategy only. Implementers run the repository suite in `AGENTS.md` plus targeted coverage:

- Unit: slug extraction (completed, invalid, nested files); violation selection given summaries; CLI usage (`--base` missing, extra positionals); `ERROR_EXIT_CODES` includes `git_error`; help/README command table stay aligned.
- Integration with `withGitRoot`: ready-and-touched fails 4; completed-in-range passes; in_progress touched passes; completed-only diffs pass; bad ref is `git_error`; command leaves `git status --porcelain` unchanged.
- No GitHub Actions job is added in this change. External CI can wrap the command later.

## Risks and Considerations

Three-dot comparison needs a merge-base. Unrelated histories fail as `git_error`; that is preferable to silently walking two unrelated trees. Callers that want a raw two-tree diff can pass the merge-base itself as `--base`.

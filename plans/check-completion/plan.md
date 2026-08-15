# Add read-only check-completion CI gate

## Summary

Add one read-only CLI command, `planlet check-completion --base <git-ref>`, that fails CI when a changeset touches an active Planlet whose canonical state is now `ready_to_complete` and that Planlet has not been archived. Callers that already ran `planlet complete <slug>` in the same changeset pass, because the active directory is gone. The command never completes, archives, edits, stages, or otherwise mutates anything.

## Scope

In scope:

- New command `planlet check-completion --base <git-ref>`.
- Required `--base` (branch, tag, or commit). Comparison is always `<resolved-oid>...HEAD` after the base is resolved to a commit OID.
- Resolve every non-empty `--base` with `git rev-parse --verify --end-of-options <base>^{commit}` before any `git diff`. Diff only the returned OID.
- Touched-slug detection from a git name-only relative NUL-separated diff of `plans/`, ignoring `plans/completed/**`.
- Violation only when a touched slug is unique across active and completed storage, still exists as an active directory, and canonical state is `ready_to_complete`.
- Actionable TOON output naming each violating slug and `planlet complete <slug>`.
- Reuse existing git spawn helper in `src/core/git.ts` for a new read-only listing function. Reuse existing uniqueness-aware loaders (`validatePlanlets({ all: true })` / `findCandidate`) plus `deriveLifecycleState` for state. No CLI-output parsing.
- User-visible docs: `README.md` command table (help-sync test), `planlet_design.md` §13.2, a pointer in §8.5, new `git_error` in §13.5, and `CHANGELOG.md` `[Unreleased]`.

Out of scope:

- Completing, archiving, editing, staging, locking, or any other mutation.
- GitHub Actions, reusable workflows, or any CI-provider adapter. Callers pass `--base` themselves.
- Generic CI/policy framework, extra policy checks, or auto-complete.
- Changing `complete`, status derivation, or agent skills / `AGENT_SNIPPET`.
- Working-tree-only uncommitted diffs as a substitute for the ref comparison.
- Optional `--head`, or loading Planlet state from an arbitrary git tree. Current checkout is the single source of truth for both changed paths and lifecycle state.

## Approach

CLI wiring follows the existing split: `src/cli.ts` parses flags and help, `src/commands/check-completion.ts` is a thin `emit` handler, domain logic lives under `src/core/`. `runGitOutput` stays private; export one read-only helper such as `listDiffPaths(repositoryRoot, { base, pathspec })` that fails the command when git fails. Do not reuse `tryStage` warning-on-failure: this command's result is the git query.

`--base` is user-controlled and must not be interpolated into a `git diff` range as a raw token. Before any `git diff`:

1. Reject an empty `--base` as `git_error`. Do not spawn git for an empty value.
2. Resolve every non-empty `--base` to a commit OID with `git rev-parse --verify --end-of-options <base>^{commit}` (argv, no shell). `--end-of-options` treats the token as revision text, so values such as `--output=plans/output` fail resolution instead of becoming Git options. Failure is `git_error`.
3. Diff only the resolved OID: `git diff --name-only --relative -z <oid>...HEAD -- plans/`.

Comparison is always that three-dot range scoped to `-- plans/` (merge-base of the resolved OID and HEAD). That is the PR changeset, not a full tree walk of the two tips. Invoke git with `cwd` set to the Planlet repository root (`--root`) so a package subdirectory inside a parent worktree still scopes the pathspec to that root's `plans/`.

`--relative` makes reported paths start at the Planlet root (`plans/<slug>/...`) even when that root is nested under the Git worktree. `-z` plus NUL splitting is required so nested filenames with spaces or newlines still count as touches. Do not `trim()` the `-z` payload (existing `runGitOutput` trims and is unsafe here); split on `\0` and drop empty segments. Rejected alternative: two-tree `git diff base HEAD`, which also reports paths that only moved on the base side after the branch point. Also rejected: optional `--head`, which would detect touched slugs from one revision and decide `ready_to_complete` from the current working tree.

A path `plans/<segment>/...` contributes `<segment>` when `segment` is a valid slug and is not `completed`. Files directly under `plans/` and every path under `plans/completed/` are ignored. Sort slugs with `byName`.

`touched` is the subset of those slugs that still exist as an active directory. Classify each touched slug with the same active/completed uniqueness rule `findCandidate` and `validatePlanlets({ all: true })` already use. A slug present in both `plans/<slug>/` and `plans/completed/<date>-<slug>/` is not unique, so it is canonically `invalid` (`completePlanlet` would reject it with `completed_plan_exists`). Do not put it in `violations` and do not recommend `planlet complete <slug>`.

`violations` is the subset of unique active touched slugs whose loaded state is `ready_to_complete`. A slug completed in-range is absent from active storage, so it cannot violate. Invalid active planlets, including uniqueness collisions, stay `invalid` and do not violate; their existing summary warnings may appear on stderr. State is read from the current working tree through the same loaders as `status` / `validate`. The git range only answers "was this slug touched."

No planlet lock. Read-only commands do not take `withPlanletLock` today, and this command must not create a holder file.

Output uses the `validate` pattern: always write one TOON report on stdout when the check ran, then remap a non-empty `violations` list to `EXIT_CODES.stateTransition` (4). Success is exit 0 with `ok: true`. Include `ok`, `base`, `touched`, and `violations` (each violation: `slug` plus `next: "planlet complete <slug>"`). Empty `touched` is success, not an error.

Git and usage failures stay structured errors, not an `ok: false` report:

- Missing `--base`, unexpected positionals, or unknown flags: existing usage exit 2.
- Empty `--base`, no git marker, unresolvable ref (including tokens that look like Git options), missing merge-base, or other git failure: new `git_error` mapped to `EXIT_CODES.operational` (1). Document `git_error` in `planlet_design.md` §13.5 alongside the other structured codes.
- Missing `plans/`: existing `plans_not_initialized`.

The command is CI-provider-neutral: no `GITHUB_*` reads, no default of `origin/main`.

## Acceptance Criteria

- `planlet check-completion --base <ref>` is documented in help and the README command table, compares `<resolved-oid>...HEAD` only, and is registered beside the other non-mutating commands. There is no `--head` flag.
- The command is read-only: it does not write plan files, take a planlet lock, stage, commit, or invoke `completePlanlet`. Unresolvable `--base` values fail as `git_error` without creating or changing any file.
- Every non-empty `--base` is resolved with `git rev-parse --verify --end-of-options <base>^{commit}` before `git diff`. Touched detection uses `git diff --name-only --relative -z <oid>...HEAD -- plans/`, ignores `plans/completed/**`, and ignores invalid slug segments. Nested `--root` usage (Planlet root is a subdirectory of the Git worktree) still extracts slugs from `plans/<slug>/...` paths.
- A unique touched active planlet in `ready_to_complete` produces a stdout report with `ok: false`, that slug in `violations` with `next: "planlet complete <slug>"`, and exit 4.
- A planlet completed in the same range (active directory gone) does not violate, even though its old `plans/<slug>/` paths appear in the diff.
- Touched `draft` / `planned` / `in_progress` / `invalid` planlets do not violate, including a touched ready-looking active slug that collides with a completed archive of the same logical slug. Untouched `ready_to_complete` planlets do not violate.
- State and uniqueness come from existing loaders (`validatePlanlets({ all: true })` / `findCandidate` / `deriveLifecycleState`), never from parsing `planlet status` output.
- Missing `--base` is usage 2. Empty or unresolvable `--base` is `git_error` on stderr and exit 1, with no filesystem mutation. `planlet_design.md` §13.5 lists `git_error`. No GitHub-specific environment or path behavior.

## Verification

Strategy only. Implementers run the repository suite in `AGENTS.md` plus targeted coverage:

- Unit: slug extraction (completed, invalid, nested files); violation selection given unique vs collided summaries; CLI usage (`--base` missing, extra positionals, rejected `--head`); `ERROR_EXIT_CODES` includes `git_error`; help/README command table stay aligned.
- Integration with `withGitRoot`: ready-and-touched fails 4; completed-in-range passes; in_progress touched passes; completed-only diffs pass; a touched ready active slug that collides with a completed archive does not violate and does not recommend `planlet complete`; bad or unresolvable `--base` is `git_error` and leaves porcelain unchanged; command leaves porcelain unchanged on success; Planlet `--root` nested under a parent worktree still detects `plans/<slug>/` via `--relative`.
- No GitHub Actions job is added in this change. External CI can wrap the command later.

## Risks and Considerations

Three-dot comparison needs a merge-base. Unrelated histories fail as `git_error`; that is preferable to silently walking two unrelated trees. Callers that want a raw two-tree diff can pass the merge-base itself as `--base`.

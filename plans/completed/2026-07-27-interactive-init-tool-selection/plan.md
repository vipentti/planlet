# Interactive Init Tool Selection

## Summary

`planlet init` stops force-installing every harness. On an interactive terminal it asks which skill destinations to install, defaulting to those that already contain something.

## Scope

`src/cli.ts`, `src/commands/handlers.ts`, `src/core/harnesses.ts`, `src/index.ts`, tests, `README.md`, and a note in `planlet_design.md`.

No new dependency and no new source file. `planlet update` is unchanged; it already skips destinations whose state is `missing`.

## Approach

### Prompting

- Prompt only when the command is `init`, `--tools` was not passed, and both stdin and stdout are TTYs. Otherwise the current `all` default stands, so agents and CI are unaffected and `--tools` remains the full non-interactive equivalent required by `planlet_design.md` section 15.3.
- The prompt is `node:readline/promises`: a numbered list with the default shown in the trailing bracket, answered with comma-separated numbers.

  ```text
  Install Planlet skills to:
    1) .claude/skills   Claude Code                  [installed]
    2) .agents/skills   Generic Agent Skills, Codex  [missing]
  Enter numbers, comma-separated, or 'none' [1]:
  ```

- Empty input accepts the default. `none` installs nothing. Unrecognized input re-asks rather than silently installing the default. Ctrl-C or EOF closes the interface, writes nothing, and exits with the usage exit code.
- The numbered prompt has no arrow-key checkboxes. Acceptable for a question asked once per repository, and no reason to add a prompt dependency.

### Choices

- Choices are destinations, not adapter IDs. `.agents/skills` is shared by the `agents` and `codex` adapters, so it appears once labelled with both display names.
- The prompt builder groups `detectHarnesses()` output by `destination`, which already carries the per-adapter display name and Planlet installation state. No new module.
- Default selection is based on destination-directory content independently from Planlet installation state: any existing entry, including a non-Planlet skill, qualifies; a missing or empty directory does not. If no destination qualifies, all are selected, matching today's behavior for a fresh repository. Path resolution retains the existing repository-boundary and symlink safety checks; inspection failures propagate.

### Async

Only `init` awaits, so only `init` becomes async.

- `handleHarnessInit` gains an optional third parameter `selectTools?: () => Promise<string | undefined>`, resolving to a **tool selector string** such as `"claude,agents"` or `"none"`, or `undefined` for cancellation. Returning the same string shape `--tools` accepts leaves all validation with `normalizeToolSelector` and keeps new types off the seam. `ExecutionContext` is unchanged, so the other handlers see nothing new.
- `handleHarnessInit` resolves the selector before calling `emit`, so `emit` stays synchronous and every other handler stays synchronous and unchanged.
- `prepareCommand` widens its prepared-handler return type to `ExitCode | Promise<ExitCode>`. `main` becomes `async`, returns `Promise<ExitCode>`, and awaits prepared-command execution inside its existing `try/catch`. `src/index.ts` becomes `process.exitCode = await main();`; top-level await is available because the bundle is ESM targeting Node 22.
- Awaiting dispatch inside `main` keeps asynchronous prompt and detection rejections at the CLI translation boundary. Expected `PlanletError` failures, including `unsafe_path`, retain structured output and mapped exit codes (5 for `unsafe_path`); unexpected errors still propagate. No local catch or fallback is added.
- `src/core/*` keeps synchronous `node:fs`.

## Acceptance Criteria

- `planlet init --tools <ids>` never prompts and behaves exactly as before.
- `planlet init` with stdin or stdout not a TTY never prompts and installs all destinations, as before.
- On a TTY without `--tools`, the user is asked; `.agents/skills` and `.claude/skills` each appear once; destinations containing any entry, including unrelated skills, form the default.
- Empty input installs the default set; an explicit subset installs exactly that subset and leaves unchosen destinations untouched.
- `none` creates `plans/` and installs no skills.
- Cancelling leaves the repository unmodified and exits non-zero.
- `planlet update` behavior and every non-`init` command's output and exit code are unchanged.

## Verification

Handler tests with an injected `selectTools` covering default-accept, explicit subset, `none`, and cancellation, plus deduplication of the shared `.agents/skills` destination, defaults for missing, empty, Planlet-populated, and unrelated-skill-populated destinations, and a non-TTY case asserting the unchanged `all` default. CLI tests also cover an async interactive-init `unsafe_path` rejection, asserting structured `unsafe_path` output and exit code 5 rather than a rejected `main` promise.

Full repository suite: `npm run format:check`, `npm run lint`, `npm run type-check`, `npm run build`, `npm test`, `git diff --check`, `git status --porcelain`.

Manual TTY runs of `node dist/planlet.mjs init` in a scratch repository with `.claude/skills` pre-populated, confirming that the default renders correctly, that `none` is accepted, and that Ctrl-C leaves the repository untouched.

## Out of Scope

- Migrating `src/core/*` to `node:fs/promises`.
- Making the remaining handlers async. Revisit if a second command ever needs to await.

# Tasks: Interactive Init Tool Selection

- [x] T9 Widen prepared-handler dispatch to `ExitCode | Promise<ExitCode>`, make `main` async and await dispatch inside its error-translation `try/catch`, and await `main` in `src/index.ts`, leaving `emit` and every non-`init` handler synchronous
- [x] T3 Add an optional `selectTools` parameter to `handleHarnessInit` and resolve the selector before `emit`, treating `undefined` as cancellation returning the usage exit code, leaving `ExecutionContext` unchanged
- [x] T4 Wire the `node:readline/promises` prompt in `src/cli.ts`, building choices by grouping `detectHarnesses()` output by destination and detecting any destination-directory content independently for defaults, gated on stdin and stdout both being TTYs, supporting empty input for the default, comma-separated numbers, `none`, re-asking on unrecognized input, and closing without writing on Ctrl-C or EOF
- [x] T6 Add handler tests with an injected `selectTools` for default-accept, explicit subset, `none`, cancellation, `.agents/skills` deduplication, and defaults for missing, empty, Planlet-populated, and unrelated-skill-populated destinations; add a non-TTY test for the unchanged `all` default and an async interactive-init `unsafe_path` test asserting structured output and exit code 5
- [x] T10 Await `main` at the call sites in `tests/unit/cli.test.ts`, `tests/integration/cli-in-process.test.ts`, `tests/integration/harness-installation.test.ts`, and `tests/skills/skill-workflows.test.ts`
- [x] T7 Update the README init section and the `--tools` help text, and add a `planlet_design.md` note reconciling section 13.1 with the section 15.3 wizard allowance
- [x] T8 Run the full verification suite and manual TTY inits in a scratch repository with a pre-existing `.claude/skills`, exercising default-accept, `none`, and Ctrl-C against the real prompt

## Completion

- Completed at: 2026-07-27T00:13:22.290Z
- Mode: normal

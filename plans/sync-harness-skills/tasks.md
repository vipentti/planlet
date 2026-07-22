# Tasks: Synchronize Harness Skills

- [x] T1 Add the directly executable `sync-skills.ps1` entry point with repository-relative source and destination resolution, and mark the file executable in Git (mode `100755`)
- [x] T2 Implement deterministic synchronization from `skills/` into `.agents/skills/` and `.claude/skills/`, including missing-directory creation and stale-content removal scoped to `planlet-*` entries so unrelated destination content is left untouched
- [x] T3 Add clear failure handling and a concise successful synchronization summary
- [x] T4 Verify direct shebang execution, execution from another working directory, idempotency, copy parity, scoped stale-content cleanup (including that non-`planlet-*` destination content survives), executable Git mode, PowerShell parsing, and diff hygiene

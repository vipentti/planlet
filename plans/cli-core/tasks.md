# Tasks: CLI Core

- [ ] T1 Create the TypeScript and Node.js package, build, test, and executable scaffold, including a `.gitignore` covering standard Node.js/TypeScript build and tooling artifacts
- [ ] T2 Define the domain models (including advisory `warnings`), structured errors, schema versioning, and exit-code categories
- [ ] T3 Implement repository-root discovery, safe path resolution, and slug and archive-name validation
- [ ] T4 Implement narrow task parsing, planlet structural validation, completion-record validation, and lifecycle status derivation
- [ ] T5 Implement safe planlet creation with automatic `plans/` setup, validated or derived titles, exactly two H1-only stub files, `draft` status, logical-slug collision refusal, and no partial result on failure, plus the list, show, status, tasks, and validate read operations
- [ ] T6 Implement atomic, idempotent task check and uncheck operations that preserve unrelated Markdown
- [ ] T7 Implement normal and incomplete-override completion with one UTC timestamp, audit recording, collision refusal, and safe movement
- [ ] T8 Implement compact default, versioned JSON, and human output renderers with stdout and stderr separation, warnings surfaced as diagnostics, and `--full`-aware truncation
- [ ] T9 Wire command parsing, explicit root selection, no-argument dashboard behavior, help, and command dispatch
- [ ] T10 Add unit tests for domain rules, status, rendering, errors, timestamps, and archive names
- [ ] T11 Add disposable integration fixtures for creation scaffolds and failure cleanup, command workflows, malformed data, collisions, unsafe paths, symlink escape, and exit behavior
- [ ] T12 Run the full verification suite and document the stable repository commands in `AGENTS.md`

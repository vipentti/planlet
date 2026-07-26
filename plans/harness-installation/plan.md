# Harness Installation

## Summary

Implement Phase 3 of `planlet_design.md` §21: install the canonical `skills/planlet-*` workflows into project-local harness directories through `planlet init`, `planlet update`, and `planlet tools`, and retire the temporary `sync-skills.ps1` dogfooding script.

## Scope

In scope:

- A data-driven harness registry covering the tool IDs `agents` (`.agents/skills`), `claude` (`.claude/skills`), and `codex` (`.agents/skills`), plus the `all` and `none` selectors, with duplicate-destination coalescing.
- An installer that resolves the canonical skill source, enumerates skill files, reconciles each destination once, records a versioned installation manifest, adopts byte-identical legacy installations, detects locally modified generated files, removes stale generated files safely, and returns a compact structured summary.
- `planlet init [--tools <ids>] [--force]`, which also initializes `plans/`, and `planlet update [--tools <ids>] [--force]`.
- `planlet tools` as a non-mutating detection command.
- The `unsupported_tool` error code and its exit-code mapping.
- CLI parsing, help surface, unit tests, and integration tests for the new commands.
- Dogfooding the installer on this repository, removing `sync-skills.ps1`, and updating repository commands and documentation accordingly.

Out of scope:

- Optional Claude command adapters under `.claude/commands/planlet/`.
- User-level installation scopes.
- Additional tool IDs such as `cursor`, `gemini`, `github-copilot`, `opencode`, and `antigravity`.
- npm packaging, `bin` publication, and CI, which belong to Phase 4.
- Changes to planlet file semantics, existing read-only commands, or lifecycle behavior.

## Approach

Represent harness support as registry data plus small behaviors, following design §15.4. Each adapter declares an ID, display name, skill directory, and command support. Selection trims and deduplicates comma-separated IDs, rejects empty values and unknown IDs, and treats `all` and `none` as exclusive selectors that cannot be combined with each other or concrete IDs. Destinations resolve beneath the repository root, and IDs that share a destination are coalesced so `agents` and `codex` reconcile the shared `.agents/skills` tree exactly once while every selected ID appears in the summary.

Resolve the canonical skill source relative to the module location so the same code works when executed from `src/` under `tsx` and from the bundled `dist/planlet.mjs`, where `skills/` sits alongside `dist/` in the published package.

Mark generated installations with a per-destination manifest file, `.planlet-manifest.json`, holding a schema version, the stable sorted set of every registry tool ID served by that physical destination, and a sorted map of relative skill file paths to SHA-256 digests. The manifest aliases do not depend on which selector produced the latest installation, so `agents` and `codex` retain consistent detection state. Installed skill files stay byte-identical to their canonical sources, which preserves the existing parity expectations and avoids injecting harness-visible banner text into `SKILL.md` frontmatter.

Reconciliation compares destination files, the previous manifest, and the current canonical tree. A file that differs from its recorded digest, an unmanifested Planlet file that differs from its canonical counterpart, or a locally modified stale file is a write conflict unless `--force` is supplied. A legacy unmanifested Planlet tree that is byte-identical to the canonical tree is adopted by writing its manifest without requiring force. Canonical files removed since the previous manifest are deleted only when the manifest proves installer ownership and their current digests still match; unrelated non-Planlet skills are never touched.

With `--tools` omitted, both `init` and `update` select `all`, because operational commands must not prompt. `init` creates missing destinations and always initializes `plans/`. `update` refreshes only managed or adoptable destinations that already contain a Planlet installation, regardless of whether selection was implicit or explicit; missing selections are reported without creating them, because adding a harness belongs to `init`.

Before any mutation, preflight selector validity, canonical source availability, path safety, manifest validity, local modifications, stale-file removals, and every selected destination. Any predictable conflict fails the whole operation without creating `plans/`, manifests, directories, or skill files. After preflight, stage and rename each skill directory and manifest so a failure cannot leave a half-written skill tree. Re-running an installation already at the desired state performs no writes.

`planlet tools` derives state from destination contents, manifest ownership, recorded digests, and the current canonical tree without mutating anything. It reports each registry tool ID independently as `missing`, `unmanaged`, `installed`, or `modified`; shared aliases receive the same physical state.

Once the commands work, this repository adopts its byte-identical bootstrap copies, stops using `sync-skills.ps1`, and manages its `.agents/skills` and `.claude/skills` trees with the CLI.

## Acceptance Criteria

- `planlet init --tools codex,agents` writes `.agents/skills/planlet-*` once, reports both tool IDs in its summary, and leaves `.claude/skills` and pre-existing non-planlet skills such as `git-commit` untouched.
- Empty selectors, unknown IDs, and combinations containing `all` or `none` plus another ID fail before any filesystem mutation; repeated concrete IDs are deduplicated.
- `planlet init --tools none` creates `plans/` and installs no skills.
- `planlet init` with no `--tools` value installs every supported adapter.
- `planlet update` never creates a missing harness destination, even when that tool ID was explicitly selected; `planlet init` installs it.
- An unmanifested Planlet tree that matches the canonical tree byte-for-byte is adopted without `--force`; a divergent unmanifested tree fails with `write_conflict`.
- `planlet update` after a local edit to an installed `SKILL.md` fails with `write_conflict`, names the affected file, and writes nothing in any selected destination; `planlet update --force` overwrites it and restores parity.
- Files removed from the canonical Planlet skills are removed during update only when the previous manifest owns them and they remain unmodified; a locally modified stale file conflicts unless forced.
- `planlet tools` mutates nothing and reports each supported tool ID with its destination and `missing`, `unmanaged`, `installed`, or `modified` state; `agents` and `codex` report consistent state for their shared destination.
- An unknown tool ID fails with `unsupported_tool` and exit code 2 without writing anything.
- A destination that resolves outside the repository root fails with `unsafe_path`.
- Installed skill trees are byte-identical to `skills/planlet-*`, manifests are deterministic, and a second identical installer run performs no writes and leaves pre-run Git status unchanged.
- `planlet help`, `planlet help init`, `planlet help update`, and `planlet help tools` document the new commands and flags.

## Verification

Run the full repository suite in order: `npm run format:check`, `npm run lint`, `npm run type-check`, `npm run build`, `npm test`, `git diff --check`, and `git status --porcelain`.

New automated coverage includes unit tests for selector normalization, registry coalescing, manifest hashing and schema handling, reconciliation, and path safety. Integration tests over temporary fixture repositories cover `init`, `update`, `tools`, legacy adoption, stale-file removal, cross-destination conflict preflight, forced recovery, idempotent zero-write reruns, and canonical-source resolution from the compiled bundle.

Dogfood with `node dist/planlet.mjs update --tools all`, capture `git status --porcelain`, run the same command again, and confirm the second run reports no changes and leaves status byte-for-byte unchanged. Inspect generated-directory diffs separately from unrelated implementation changes.

## Risks and Considerations

- Harness path conventions can change. Keeping destinations as registry data with direct test coverage keeps the correction small.
- The bundled CLI must still find `skills/` at runtime. A compiled-bundle test guards this rather than relying on development-time paths.
- A dot-prefixed manifest file inside a skills directory could confuse a harness scanner. The file is hidden, documented, and holds no skill frontmatter.
- Unexpected filesystem failure can still complete one destination before another after global preflight; per-skill atomic publication prevents partial trees, and rerunning the deterministic operation converges remaining destinations.
- Removing `sync-skills.ps1` shifts a working dogfooding path onto new code, so the replacement is verified on this repository before the script is deleted.

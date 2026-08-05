# Tasks: Knip Adoption

- [x] T1 Add knip devDependency and `npm run knip` script
      Acceptance:
      - `package.json` gains `"knip": "6.31.0"` under `devDependencies`
        (exact pin, sorted between `eslint` and `prettier`) and
        `"knip": "knip"` under `scripts`.
      - `package-lock.json` updated via `npm install`; `npx knip --version`
        prints `6.31.0`; `npm run knip` executes knip (exit 1 with the known
        findings is expected until T3).
- [x] T2 Add `knip.json` allowlisting the `ssh-keygen` binary
      Acceptance:
      - `knip.json` exists with `$schema` and
        `ignoreBinaries: ["ssh-keygen"]` only; no entry/exports config added
        (knip defaults).
      - `npm run knip` reports no unlisted binaries; the 13 unused-export
        findings remain until T3.
      - `knip.json` added to `format`/`format:check` globs in `package.json`;
        `npm run format:check` green.
      Evidence basis: `tests/integration/release-utility.test.ts:120,123,137`
      spawn `ssh-keygen`; `ignoreBinaries` is the documented knip config option
      (verified in knip 6.31.0 schema).
- [x] T3 De-export the verified-unused symbols knip flags
      Acceptance:
      - Fresh `npm run knip` on the current branch lists exactly the 13
        exports named in plan.md Approach (line numbers may shift; match by
        symbol).
      - For each symbol, `rg -n "<symbol>" src tests scripts` shows only
        declaring-module references; no cross-file import.
      - `export` keyword removed from all 13 declarations; no other code
        change in those files.
      - If any flagged symbol is actually consumed (test, DI seam, public
        surface), keep the export and tag `/** @public */` instead of
        removing it.
      - `npm run knip` exits 0 with zero findings; `npm run type-check`,
        `npm run lint`, `npm run build`, `npm test` all green.
      Evidence basis: 13-symbol file:line list in plan.md Approach (fresh
      knip run 2026-08-05 on current main; scout's pre-T4 list predates the
      T4 refactor).
- [x] T4 Wire knip into CI and run the full verification suite
      Acceptance:
      - `.github/workflows/ci.yml` verify matrix gains `- run: npm run knip`
        directly after `npm run lint`.
      - Full suite green: `npm run format:check`, `npm run lint`, `npm run
        type-check`, `npm run build`, `npm test`, `git diff --check`.
      - `git status --porcelain` empty; diff contains only the intended files
        named in plan.md Acceptance Criteria.
      - PR CI shows the knip step green.

## Completion

- Completed at: 2026-08-05T07:39:05.212Z
- Mode: normal

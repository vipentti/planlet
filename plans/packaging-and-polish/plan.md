# Packaging and Polish

## Summary

Implement Phase 4 of `planlet_design.md` §21: turn the working repository into a
publishable npm package with a `bin` entry, guarantee the bundled single-file
artifact is present in every tarball, verify the package on maintained Node and
operating-system combinations in CI, and document installation and day-to-day
use. The planlet ends publish-ready; it does not publish.

## Scope

In scope:

- Publish metadata in `package.json`: `version` 0.1.0, `license`, `author`,
  `repository`, `homepage`, `bugs`, and `keywords`, targeting
  `https://github.com/vipentti/planlet`.
- An MIT `LICENSE` file, matching design §16.2 suggested package contents.
- A `prepack` script that builds `dist/planlet.mjs`, because `dist/` is
  gitignored and would otherwise be absent from a published tarball.
- Reclassifying `@toon-format/toon` as a development dependency, since the
  bundle inlines it and the published executable imports only `node:` builtins.
- `planlet --version`, resolved identically under `tsx` and the bundle.
- A packaging integration test that packs the real tarball, installs it into a
  temporary directory, and runs the packaged executable against a temporary
  repository.
- A GitHub Actions workflow running the full verification suite on
  `ubuntu-latest`, `macos-latest`, and `windows-latest` against Node 22 and
  Node 24, plus a Linux-only guard that installed skill copies match canonical
  sources.
- Cross-platform fixes for failures the first Windows and macOS runs expose.
- README installation, quickstart, and command reference; `AGENTS.md` updates
  only where repository commands or structure actually change.

Out of scope:

- Running `npm publish`. Release execution stays a human action.
- Release automation, changelogs, version-bump tooling, and provenance signing.
- Optional harness command adapters. Design §21 lists them as optional and §24
  leaves their value open; skills are already discovered by every supported
  harness, so adapters would add generated-file surface without a demonstrated
  need.
- Standalone Bun, Deno, or Go binaries, user-level install scopes, and the
  deferred `--json`, `--human`, and `--quiet` output modes.
- Changes to planlet file semantics, lifecycle behavior, or existing command
  output.

## Approach

Treat the tarball, not the working tree, as the artifact under test. The
existing `files` allowlist already publishes `dist`, `skills`, and `README.md`,
and npm always includes `package.json` and `LICENSE`, so the published tree
matches the layout `resolveCanonicalSkillsPath` expects: `skills/` beside
`dist/`. The gap is timing rather than content, so `prepack` runs the build and
the packaging test proves the result instead of trusting the allowlist.

Verify packaging the way a user installs it. Take the published file list from
`npm pack --json` rather than untarring and inspecting paths by hand, then
`npm install` that tarball into a temporary directory and drive the CLI through
the installed `bin` shim against a fresh temporary repository. Installing
exercises what manual extraction skips: `bin` registration, executable
permissions, and the shebang. Assert both inclusion and exclusion in the packed
list: `dist/planlet.mjs`, `package.json`, `README.md`, `LICENSE`, and every
canonical `skills/planlet-*` file are present, while `src/`, `tests/`,
`plans/`, `.claude/`, and `.agents/` are absent. This is the only check that
would catch a missing build hook, an over-broad allowlist, or canonical skills
that resolve in development but not from an install.

Move `@toon-format/toon` from `dependencies` to `devDependencies`. The esbuild
bundle inlines it, so `dist/planlet.mjs` imports nothing but `node:` builtins
and a consumer currently installs a package the executable never resolves.
Reclassifying it makes the published package dependency-free, which also lets
the packaging test install its tarball without network access. Design §16.1
still governs source usage; only distribution changes. Restore the runtime
dependency if Planlet ever ships unbundled modules.

Resolve the version at runtime with
`createRequire(import.meta.url)("../package.json").version` rather than an
esbuild `define`. Both `src/cli.ts` under `tsx` and the bundled
`dist/planlet.mjs` sit one directory below `package.json`, so one expression
works in both without build-time substitution, and esbuild leaves
`createRequire` calls for the runtime instead of trying to inline the JSON.
`--version` prints the bare version and exits zero, mirroring how `help` prints
plain text rather than TOON.

Keep CI as one matrix job that runs the documented suite in the documented
order, so a contributor's local run and a CI run cannot diverge. Add
`.github/workflows/*.yml` to the Prettier globs so the workflow is covered by
`format:check` like every other project file. The generated-skill drift guard
runs `update --tools all` followed by `git diff --exit-code` on Linux only,
because a Windows checkout normalizes line endings and would report unrelated
diffs.

## Acceptance Criteria

- `npm pack` after `rm -rf dist` reports `dist/planlet.mjs`, `package.json`,
  `README.md`, `LICENSE`, and every canonical `skills/planlet-*` file, and no
  `src/`, `tests/`, `plans/`, `.claude/`, or `.agents/` entry.
- `npm install <tarball>` into an empty directory succeeds without network
  access and installs no transitive dependencies; the resulting `planlet` shim
  runs `init`, `list`, and `tools` against a temporary repository and reports
  its skill destinations as installed.
- `planlet --version` prints exactly the `package.json` version and exits zero,
  producing identical output from `tsx` and from `dist/planlet.mjs`;
  `planlet help` documents it.
- `package.json` declares version 0.1.0, MIT license, author, the
  `github.com/vipentti/planlet` repository, homepage, bugs URL, and keywords; a
  top-level MIT `LICENSE` file exists.
- `npm publish --dry-run` exits zero and reports the same file list the
  packaging test asserts.
- The CI workflow runs `format:check`, `lint`, `type-check`, `build`, and
  `test` on ubuntu, macos, and windows against Node 22 and Node 24, and passes
  on every combination.
- CI fails when installed skill copies drift from `skills/`.
- The README documents global install, `npx` execution, a first-planlet
  quickstart, and every command in the current `planlet help` output, with no
  claim that the CLI is unbuilt or unreleased.

## Verification

Run the full suite in order: `npm run format:check`, `npm run lint`,
`npm run type-check`, `npm run build`, `npm test`, `git diff --check`, and
`git status --porcelain`.

New automated coverage: one CLI smoke check for `--version` output and exit
code, and one packaging integration test covering the packed file list, tarball
installation, and execution through the installed shim.

Manual verification: `rm -rf dist && npm pack --dry-run` to confirm `prepack`
restores the bundle, `npm publish --dry-run` to review the published file list,
and inspection of the first CI run across all six matrix combinations. Report
CI results per combination; a green Linux run alone does not satisfy this
planlet.

## Risks and Considerations

- Windows is unexercised today, so the first CI run may fail in several modules
  at once: path separators, `realpath` casing, temporary-directory resolution,
  or assertions embedding a platform-specific path or line ending. Fixes belong
  to the module at fault, not to test skips, and CI is not green until all six
  combinations pass.
- The packaging test invokes `npm pack` and `npm install`, so it is slower than
  the rest of the suite and depends on `npm` being on `PATH`. It stays in the
  default suite because a packaging guard that only runs on request is a guard
  that will not run before a release. The Windows `bin` shim is `planlet.cmd`,
  so the test must resolve the shim name per platform.
- `prepack` also runs on `npm pack`, so the test rebuilds `dist/`. Because
  `dist/` is gitignored this cannot dirty Git status, but the test must not
  assume a pre-existing bundle.
- Version 0.1.0 signals an unstable interface. Publishing itself remains a
  deliberate human step, and the npm name `planlet` is currently unregistered.
- CI cost grows with the matrix. Six combinations is the minimum that covers
  the two supported Node versions on all three platforms.

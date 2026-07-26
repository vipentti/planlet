# Tasks: Packaging and Polish

- [x] T1 Add publish metadata to `package.json` and a top-level MIT `LICENSE`
- [x] T2 Add a `prepack` build hook, reclassify `@toon-format/toon` as a development dependency, and confirm the published file allowlist
- [x] T3 Implement `planlet --version` resolving identically under `tsx` and the bundle, document it in the help surface, and cover it with one CLI smoke check
- [x] T5 Add a packaging integration test asserting the `npm pack` file list, installing the tarball, and running the installed shim against a temporary repository
- [x] T6 Add a GitHub Actions matrix workflow for ubuntu, macos, and windows on Node 22 and 24 that passes on every combination, including the Linux-only generated-skill drift guard, and cover workflow files with Prettier
- [x] T8 Rewrite README installation, quickstart, and command reference, and update `AGENTS.md` where commands or structure changed
- [x] T9 Run the full verification suite plus `npm publish --dry-run`, and record the published file list and per-combination CI results

# Split release docs out of README

## Summary

Move changelog and tag-release procedure out of `README.md` into a new root
`RELEASING.md` shared by humans and agents. Keep the README product-facing;
retarget `AGENTS.md` pointers; include the new file in Prettier globs.

## Scope

- Add `RELEASING.md` with the current README changelog/release content (including
  tag-triggered releases and the link to the completed release-automation
  planlet).
- Remove that section from `README.md`; add a Links entry and a short breadcrumb.
- Point `AGENTS.md` release guidance and the `--release-date` rejected-simplification
  note at `RELEASING.md` instead of `README.md`.
- Add `RELEASING.md` to `format` / `format:check` Prettier globs in `package.json`.

## Out of Scope

- Moving Development, skill-installation details, or other README sections.
- Changing release workflow code, changelog scripts, or CI behavior.
- Creating `CONTRIBUTING.md` or a `docs/` tree.
- Publishing `RELEASING.md` in the npm package `files` allowlist (maintainer-only).

## Approach

1. Create `RELEASING.md` by relocating the README "Changelog and releases"
   section (and its "Tag-triggered releases" subsection) with relative links
   appropriate for a repo-root doc.
2. Slim `README.md`: drop that section; link `RELEASING.md` from Links; keep a
   one-line pointer near Development or Links.
3. Update `AGENTS.md` so release maintenance and the `--release-date` note cite
   `RELEASING.md`.
4. Extend Prettier script globs so the new file is formatted like README/CHANGELOG.

## Acceptance Criteria

- `README.md` has no changelog/release procedure body; it links to `RELEASING.md`.
- `RELEASING.md` contains the moved guidance (changelog upkeep, assert scripts,
  tag-triggered flow, bootstrap note, link to completed release-automation plan).
- `AGENTS.md` points at `RELEASING.md` for release/changelog guidance, not README.
- `package.json` format scripts include `RELEASING.md`.
- Local relative links in the edited Markdown resolve to existing paths.
- No product/CLI behavior change.

## Verification

Markdown-only checks: confirm referenced local paths exist; `npm run format:check`
after Prettier glob update; `git diff --check`. No need for lint/type-check/build/test
unless unrelated files change.

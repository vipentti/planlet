# Changelog agent upkeep

## Summary

Catch up `[Unreleased]` for the shipped `planlet-plan` design-doc reference
fix, and make changelog upkeep an explicit agent working rule in this
repository so user-visible product changes land under `Unreleased` as work
happens—not only as a PR-checklist afterthought.

## Scope

- Add one Keep a Changelog `[Unreleased]` → `### Fixed` entry for commit
  `1628ba8` / #19 (`planlet-plan` no longer names `planlet_design.md`
  directly).
- Add a short changelog-upkeep rule to `AGENTS.md` (near working rules /
  pull-request guidance) that:
  - requires updating `CHANGELOG.md` → `Unreleased` in the same change set
    when the change is user-visible product, CLI, or published-skill behavior;
  - allows an explicit “no entry needed” judgment for chore, internal-only,
    or contributor-doc-only work;
  - points at [`RELEASING.md`](../../RELEASING.md) for format and release-cut
    procedure rather than duplicating it.
- Optionally one clarifying sentence in the existing `AGENTS.md` Pull
  requests section that the template’s contributor checklist includes the
  changelog item (no template body change).

## Out of Scope

- Editing `.github/pull_request_template.md` (already has the Unreleased
  checklist item).
- Portable canonical skills under `skills/` (they install into other repos).
- Backfilling `#18` (PR-template `AGENTS.md` guidance) or older history.
- Release automation, version bumps, or changelog assert-script changes.

## Approach

1. Write the #19 Fixed bullet under existing `[Unreleased]` in
   `CHANGELOG.md`, matching Keep a Changelog style already used there.
2. Strengthen agent duty in `AGENTS.md` so implementers update the changelog
   during the change, while PR template remains the review-time reminder.
3. Keep `RELEASING.md` as the single format/release authority; `AGENTS.md`
   only states when and that agents must act.

## Acceptance Criteria

- `[Unreleased]` includes a Fixed entry describing the #19 skill design-ref
  fix; no `#18` entry.
- `AGENTS.md` requires updating `CHANGELOG.md` → `Unreleased` for
  user-visible product / CLI / published-skill changes, with an allowed
  explicit skip for non-user-visible work, and links `RELEASING.md` for
  format.
- `.github/pull_request_template.md` is unchanged.
- Portable `skills/` sources are unchanged.
- Referenced local paths exist; Markdown and changelog structure remain
  valid.

## Verification

Markdown / docs-only change:

- Confirm referenced paths (`CHANGELOG.md`, `RELEASING.md`,
  `.github/pull_request_template.md`) exist.
- Run `node scripts/assert-changelog-release-ready.mjs` (ordinary CI mode).
- Run `git diff --check`.
- Confirm the diff contains only intended `CHANGELOG.md` and `AGENTS.md`
  edits (no leaked tool markup).

No full `npm test` suite required unless an implementer touches code outside
this scope.

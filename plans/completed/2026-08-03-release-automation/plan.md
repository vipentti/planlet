# Release Automation

## Summary

Release Planlet through a hand-maintained Keep a Changelog file and a small,
tag-triggered GitHub Actions workflow. Workflow verifies tagged source, publishes
an exact packed artifact to npm through trusted publishing with provenance, and
creates or updates GitHub release notes from changelog.

Land work in two slices so the first npm publication can use a clean `main`
artifact without activating release automation early:

- **Slice A:** changelog, extractor, packaging tests, and source-fallback docs
  on `main` with no `release.yml`.
- **Slice B:** tag-triggered workflow, remaining release docs/`AGENTS.md`
  pointers, and post-bootstrap automation proof.

Task-branch review is allowed, but public visibility, npm publication, tags,
GitHub releases, trusted-publisher configuration, release-governance changes,
and merges of Slice B remain blocked on recorded captain decisions and
separately checkable external-action tasks.

## Scope

In scope:

- Root `CHANGELOG.md` following Keep a Changelog 1.1.0, packaged and formatted.
- Dependency-free `scripts/changelog.mjs` plus subprocess coverage.
- `.github/workflows/release.yml`, triggered only by `v*` tags.
- Exact release checks, npm provenance, changelog-derived notes, serialized
  same-tag runs, and verified rerun recovery.
- Accurate release, changelog, and pre-publication documentation.
- Full-history secrets, licensing, and personal-data review before visibility.
- Exact source/artifact and npm account/name/auth preconditions for bootstrap.
- Reconciliation onto current `main`, including its verification-evidence
  contract and current release-governance protections.
- Explicit unresolved public-release and release-governance decisions.

Out of scope:

- Release frameworks, generated changelogs, automated version selection,
  prerelease channels, extra dist-tags, token fallback, or standalone binaries.
- Semantic CLI, Planlet lifecycle, or skill-workflow changes.
- Any external release mutation during implementation.

## Approach

### Phased landing

Slice A lands first so captain can name a clean `origin/main` SHA whose packed
artifact includes `CHANGELOG.md` while the default branch still lacks
`release.yml`. Slice B lands only after verified 0.1.0 publication, matching
tag/release creation, and trusted-publisher configuration.

### Changelog and extraction

Keep changelog hand-written because user-visible changes do not map reliably to
commit subjects. `scripts/changelog.mjs <version> [file]` prints body of one
dated version section. It rejects missing, empty, and `Unreleased` sections.
Optional file argument exists for isolated subprocess tests.

Backfill 0.1.0 from complete repository history and user-visible package
behavior, not completed planlets alone. Keep `Unreleased` first and compare
links last.

### Release workflow

Tag is manual release decision. Only **new** `v*` tag creates (not
force-moves or deletes) start the job. The job uses GitHub Environment
`release` with required reviewers. Workflow checks out full history, verifies
GitHub reports the annotated tag as signed, installs from lockfile, then
performs these checks before publication:

1. tag is exactly `v<package.json version>`;
2. tagged SHA is reachable from explicitly fetched `origin/main`;
3. `format:check`, `lint`, `type-check`, `build`, and full tests pass;
4. `git diff --check` passes;
5. generated skill copies match canonical sources after `planlet update`;
6. tagged source remains clean;
7. requested changelog section exists and has an entry;
8. `npm pack --json --ignore-scripts` succeeds against that verified build and
   yields reviewed package metadata.

Workflow pins its two external actions to reviewed commit SHAs. A workflow-level
concurrency group serializes runs for same tag without cancelling an in-flight
publication. npm `^11.5.1` supplies trusted-publishing support; no `NPM_TOKEN`
exists. Workflow publishes exact tarball produced by `npm pack` with public
access and provenance. After a new publish, it waits for registry visibility and
re-runs the same identity/integrity checks before mutating the GitHub release.
First-publication path also runs
`assert-changelog-release-ready.mjs --release-date` for the current UTC day;
reruns skip that date gate.

Rerun does not treat any registry hit as success. When exact version exists,
workflow compares registry package name, version, repository, available
`gitHead`, and integrity against tagged source and freshly packed artifact. Any mismatch
fails before GitHub release mutation. Only a verified exact artifact skips npm
publication. Non-404 lookup failures fail rather than falling through to
publish. Existing GitHub release notes are replaced from changelog; missing
release is created from same file.

Repository-side controls: `v*` tag ruleset restricts create/update/delete to
admins; Environment `release` requires a reviewer before the job can use
OIDC/publish permissions. npm trusted publisher must name Environment `release`
to match.

### Publication gates and unresolved decisions

No external step proceeds until captain records all choices:

1. **Public release:** authorize exposing full repository history after T7 audit,
   or keep repository private and defer publication/provenance.
2. **Release governance:** after bootstrap, captain amended T15 to add a `v*`
   tag ruleset (admin bypass) and GitHub Environment `release` with required
   reviewers, plus workflow guards against force-moved tags and verified signed
   tags. Ancestry still proves reachability, not review; the environment and
   ruleset supply authorization.
3. **Bootstrap:** approve npm owner/account, available package name, exact clean
   source SHA, reviewed artifact hash/file list, and irreversible 0.1.0 publish.

README documents changelog upkeep and the common tag-triggered release flow for
`@vipentti/planlet`. The first publication was a manual bootstrap without
`release.yml` on `main`; later releases use the tag workflow after trusted
publishing is configured. AGENTS points to these owner documents without
duplicating release procedure.

### Exact bootstrap artifact procedure

Captain names one clean `origin/main` SHA as `BOOTSTRAP_SHA`; no worker infers
it. If the `[0.1.0]` changelog header date still differs from the intended
publish day, update that date on `main` first so the approved SHA includes it.
In a fresh detached checkout of that SHA:

1. verify `HEAD == BOOTSTRAP_SHA`, no tracked/untracked files, package and
   lockfile both declare 0.1.0, and repository still lacks active release
   workflow on default branch;
2. run `npm ci`, full local verification suite, generated-skill parity, and
   clean-tree check;
3. run `npm pack --json --pack-destination <empty-review-dir>` once;
4. record SHA, package name/version, tarball filename, `integrity`, `shasum`,
   exact file list, and local SHA-256; inspect tarball for secrets, license,
   personal data, and unexpected files;
5. obtain captain approval for recorded artifact, publish that exact `.tgz`
   with `--access public`, and verify registry integrity/file list;
6. create `v0.1.0` at same `BOOTSTRAP_SHA` only after publication succeeds,
   then create GitHub release from reviewed 0.1.0 notes.

Never rebuild between approval and publish. Failed publish stops; do not claim,
deprecate, or retry with changed source without new artifact review.

### External sequence

After all gates:

1. T10 checks npm name availability, authenticated account, required 2FA/auth,
   owner identity, and public-package access at execution time.
2. T7 completes full-history audit and captain sign-off; T11 changes visibility
   and verifies anonymous access.
3. T8 publishes exact approved 0.1.0 artifact; T12 creates matching tag/release.
4. T13 configures trusted publisher for npm package `@vipentti/planlet` on
   GitHub repository `vipentti/planlet` with workflow
   `.github/workflows/release.yml` and Environment name `release` (must match
   the workflow `environment:`).
5. T14 lands Slice B automation and confirms main CI before any automated tag.
6. T19 hardens release governance and workflow before T9.
7. T9 prepares 0.1.1 on main, pushes source before tag, performs real release,
   and records workflow/provenance/release evidence.

This order prevents bootstrap tag from activating workflow and ensures
ancestry guard can pass for 0.1.1.

## Acceptance Criteria

- Changelog has `Unreleased` first, reverse-chronological dated versions,
  standard Keep a Changelog headings only, no empty change headings, and links.
- Extractor prints only requested notes and rejects missing, empty, or
  `Unreleased` sections with version in error.
- Package tarball contains changelog; Prettier and packaging tests cover it.
- Release workflow trigger, permissions, pinned external actions, version and
  ancestry guards, exact check sequence, provenance, no-token auth, notes,
  concurrency, and rerun verification match approach above.
- Existing npm version is accepted only when registry identity and artifact
  integrity match, plus source SHA when registry exposes `gitHead`; unexpected
  state fails before release edit.
- Existing GitHub release is updated; absent release is created; both use exact
  extracted notes.
- Full-history audit covers secrets, credentials, licenses/provenance,
  third-party material, personal data, deleted paths, commit metadata, tags,
  branches intended for exposure, and large/binary objects, with findings and
  captain sign-off recorded before public visibility.
- Bootstrap record identifies exact clean source SHA and exact reviewed tarball;
  npm name/account/auth/ownership/public-access checks are current at publish.
- Public visibility, release governance (T15), and bootstrap authorization (T16)
  are recorded; remaining external gates are trusted publishing (T13) and Slice B
  merge (T14) before automated 0.1.1 proof (T9).
- Active plan records routine verification as strategy and task state only;
  exceptional evidence is retained only when ordinary history cannot reconstruct
  a durable fact, and every line is write-once and non-self-referential.
- README documents changelog upkeep, `@vipentti/planlet` install, and the common
  tag-triggered release flow; AGENTS points to these owner documents without
  duplicating release procedure.
- Slice A merged without `release.yml`; Slice B lands only after T12-T13.

## Verification

Implementation checks:

```sh
npm run format:check
npm run lint
npm run type-check
npm run build
npm test
npm pack --json --dry-run
npm publish --dry-run
node dist/planlet.mjs update --tools all
git diff --exit-code -- .agents .claude
git diff --check
git status --porcelain
```

Also run focused extractor cases against root and an isolated temp changelog,
inspect workflow YAML and packed file list, validate Planlet through built CLI,
and require protected pull-request CI to pass before merge. Dry runs cannot prove
OIDC, provenance, GitHub release mutation, or public visibility. Routine run
results stay in Git, tests, pull-request review, and CI. Add evidence to
`tasks.md` only for a durable fact ordinary history cannot reconstruct; keep
each line write-once and non-self-referential.

## Risks and Considerations

- Public visibility exposes reachable history; tip cleanup is insufficient.
- npm publication and public-history disclosure are effectively irreversible.
- Protected `main` still lacks administrator enforcement; release authorization
  additionally uses a `v*` tag ruleset, Environment `release` with required
  reviewers, and workflow rejection of force-moved tags.
- Trusted-publisher mismatch (including Environment name drift) commonly appears
  as 401/403 after checks pass.
- npm name or ownership can change before execution; recheck immediately.
- Concurrent same-tag runs are serialized, but failed external state must still
  satisfy exact rerun verification.
- Hand-maintained changelog can be wrong; extractor prevents empty notes, not
  inaccurate prose.
- Landing Slice B before bootstrap would fire the workflow on `v0.1.0` without
  trusted publishing configured.

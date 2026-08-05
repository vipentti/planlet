# Auto Signed Release

## Summary

Replace the tag-push release workflow with one branch-triggered run: a push to
`main` is classified by a dependency-free Node detection script; a version
changing, file-exact release merge gates a protected `release` job that creates
and pushes an annotated GPG-signed `v<version>` tag at the exact triggering
commit, publishes the verified package to npm with provenance, and creates or
updates the GitHub release. Ordinary main pushes succeed without environment
approval, release secrets, tags, npm publication, or GitHub releases. Pushing
the tag never starts a second workflow run.

## Scope

In scope:

- Rewrite `.github/workflows/release.yml`: trigger on `push` to `main` only;
  unprotected detection job; protected release job that is the only job
  referencing `environment: release` and the only job reading release secrets.
- New dependency-free `scripts/detect-release-merge.mjs` for release-merge
  detection and validation, reusing the existing changelog helper's historical
  mode as the sole changelog parser.
- New dependency-free `scripts/verify-release-tag.mjs` shared by the workflow
  and `scripts/release.mjs` so tag validation is not duplicated.
- Minimal `scripts/release.mjs` adjustment: delegate local-tag validation to
  the shared verifier; `prepare`, dry-run defaults, `tag` break-glass flow, and
  existing guards stay.
- `RELEASING.md` rewrite of the normal release procedure, required environment
  secrets/variables, GitHub App and tag-ruleset setup, rerun behavior, recovery,
  key rotation, and unsupported overlapping releases.
- Short supersession note in `plans/completed/2026-08-03-release-automation/plan.md`
  pointing at `RELEASING.md`; historical task evidence is not rewritten.
- Focused subprocess tests for detection and the shared tag verifier; workflow
  YAML inspection per the criteria below.

Out of scope (all external release mutations): creating or pushing real tags,
npm publication, GitHub releases, repository settings changes (tag ruleset,
environment, trusted publisher), and credential creation. No new dependencies,
no release framework, no unpinned third-party GPG action. No `CHANGELOG.md`
entry: this is repository-local maintainer tooling, not published Planlet
surface.

## Approach

### Detection helper

`scripts/detect-release-merge.mjs --before <sha> [--after <sha>]` runs in a
checkout of the triggering commit. `--after` defaults to `HEAD`; when passed it
must equal `HEAD`, so the target is provably the exact triggering `github.sha`.
The script reads the after-state files from the worktree and before-state files
from `git show <before>:<path>`.

Output contract: success prints exactly one JSON line to stdout
(`{"isRelease":false}` or `{"isRelease":true,"version":"X.Y.Z"}`); any refusal
writes a diagnostic to stderr and exits nonzero. Missing, non-hex, all-zero, or
unresolvable `before` fails closed with an "ambiguous previous SHA" diagnostic —
never silently ordinary, never a release.

Release classification requires ALL of:

1. `package.json.version` changed between `before` and `after`.
2. New version is valid stable `X.Y.Z` semver (numeric segments, no
   prerelease/build metadata).
3. `package.json.version`, `package-lock.json.version`, and
   `package-lock.json.packages[""].version` agree.
4. Changelog helper historical mode
   (`scripts/assert-changelog-release-ready.mjs --verify-release --print-date`)
   passes against the after commit: exactly one valid dated `[new version]`
   section, empty `[Unreleased]`, non-empty notes, valid calendar date.
5. `git diff --name-only before after` is exactly `CHANGELOG.md`,
   `package.json`, `package-lock.json`.
6. New version differs from previous and is greater (numeric segment compare).
7. `v<version>` ref does not point to a different commit: absent or pointing at
   the after commit is fine; any other target fails.

Version unchanged → `isRelease:false`, workflow succeeds with no release work.
Version changed but any rule fails → nonzero exit (ambiguous state never
silently treated as ordinary).

### Workflow

```text
on: push: branches: [main]
permissions (workflow): contents: write, id-token: write
concurrency: group release-main, cancel-in-progress: false

detect:  no environment; permissions contents: read
  checkout (full history, persist-credentials: false)
  run scripts/detect-release-merge.mjs --before "${{ github.event.before }}" --after "$GITHUB_SHA"
  set outputs: is-release, version (from script JSON via jq)

release: needs detect; if is-release == 'true'; environment: release
  permissions: contents: write, id-token: write
  steps:
    1. checkout ref github.sha, fetch-depth 0, persist-credentials false
    2. fetch origin/main; verify triggering commit reachable from it
    3. GPG setup (below)
    4. ensure exact signed tag (below)
    5. GitHub tag-object verification with bounded retry
    6. setup-node; npm ci; format:check, lint, type-check, build, test,
       git diff --check; generated-skill parity; clean-source check
    7. extract release notes via scripts/changelog.mjs
    8. npm pack --json --ignore-scripts
    9. publish or verify npm artifact (existing logic preserved)
    10. create or update GitHub release from notes
    11. always(): remove passphrase file and GNUPGHOME
```

The detection job never references `environment:` and never reads `RELEASE_*`
secrets (App ID/key or GPG material); it cannot start the protected job.
`needs.detect.outputs.is-release` / `.version` propagate from the unprotected
job. The branch trigger means a tag push cannot start another run, so tagging
and publication happen in one run with no recursion.

### GPG tag signing

Steps run only in the protected job, with `set -euo pipefail`:

1. `GNUPGHOME=$(mktemp -d)`; `chmod 700`.
2. Write `RELEASE_GPG_PASSPHRASE` to `$GNUPGHOME/passphrase`; `chmod 600`;
   never echo it or pass it as a command-line argument.
3. Import `RELEASE_GPG_PRIVATE_KEY` (ASCII-armored) via
   `printf '%s\n' "$RELEASE_GPG_PRIVATE_KEY" | gpg --batch --import`.
4. Parse `gpg --list-secret-keys --with-colons`; require the secret-key
   fingerprint to equal `RELEASE_GPG_FINGERPRINT` exactly; fail otherwise.
5. Write a small wrapper script in `$GNUPGHOME` that execs
   `gpg --batch --pinentry-mode loopback --passphrase-file "$GNUPGHOME/passphrase" "$@"`;
   `chmod 700`; point `git config gpg.program` at it. Batch mode plus loopback
   pinentry makes signing non-interactive; the passphrase appears only in the
   mode-0600 ephemeral file.
6. `git config user.name "$RELEASE_GIT_NAME"`, `user.email "$RELEASE_GIT_EMAIL"`,
   `user.signingkey "$RELEASE_GPG_FINGERPRINT"`.
7. Cleanup step runs `if: always()`: `rm -f "$GNUPGHOME/passphrase"` then
   `rm -rf "$GNUPGHOME"`.

The private key signs release tags only; Git commit signing stays off
(`commit.gpgsign false`).

### Exact tag ensure/verify

Remote absent path: `git tag -a -s "v$VERSION" -m "Release v$VERSION" "$GITHUB_SHA"`;
verify locally with the shared tag verifier; push only that ref with a
short-lived GitHub App installation token (generated by the pinned
`actions/create-github-app-token` action, scoped to `planlet` with Contents
write only) through a `git -c http.extraheader=...` basic-auth header (never in
the URL or logs); the token is generated only when the remote tag is absent.
Then re-verify the remote ref points at the exact tag object. Non-force push
only; a ruleset rejection fails the job with git's diagnostic.

Remote exists path: `git fetch --no-tags origin +refs/tags/v<version>:refs/tags/v<version>`;
require an annotated tag object, exact target commit, exact message subject,
and `git verify-tag` success via the shared verifier; mismatched state fails
without mutation (force-moved, deleted, or redirected tags are refused by the
exact-object and exact-commit checks).

After the tag exists remotely (just pushed or pre-existing), query
`gh api repos/<owner>/<repo>/git/tags/<tag-object-sha> --jq .verification` and
require `.verified == true` before npm publication, with a small bounded retry
(e.g. up to 5 attempts, 6s apart) for visibility lag.

### Shared tag verifier

`scripts/verify-release-tag.mjs --tag v<version> --target <sha> --message <expected>`
validates in the current repo: object type is annotated (`tag`), target commit
equals `--target`, subject equals `--message`, and `git verify-tag` exits 0; on
success prints the tag object SHA. `scripts/release.mjs` delegates its
existing-local-tag validation and its fresh-tag post-creation verification to
this helper (message `v<version>`, target `HEAD`); all other `tag` guards,
dry-run behavior, and push/remote verification stay in `release.mjs`. Fixture
repos in `tests/integration/release-utility.test.ts` copy the helper next to
the other scripts.

### Documentation

`RELEASING.md` normal flow becomes: 1) `npm run release:prepare -- --version X.Y.Z --execute`;
2) review and merge the `release/vX.Y.Z` PR; 3) inspect the pending workflow
deployment; 4) approve the `release` environment; 5) verify the signed tag, npm
package/provenance, and GitHub release. Document all required environment
secrets (`RELEASE_GPG_PRIVATE_KEY`, `RELEASE_GPG_PASSPHRASE`,
`RELEASE_APP_PRIVATE_KEY`) and variables (`RELEASE_APP_ID`,
`RELEASE_GPG_FINGERPRINT`, `RELEASE_GIT_NAME`, `RELEASE_GIT_EMAIL`); dedicated
release-only GPG key whose email is verified on the GitHub account holding the
public key; Release Automation GitHub App installed only on
`vipentti/planlet` with repository Contents read/write and added as an
always-allowed actor on the existing `v*` tag-creation bypass list; updates,
force changes, and deletions remain prohibited by the ruleset; short-lived
installation tokens generated per approved release run; a maintainer PAT is
not workflow configuration (last-resort manual recovery only); rerun behavior;
`release:tag` as break-glass recovery (no longer the normal happy path); key
rotation at a high level; and that merging another release PR before the
previous release completes is unsupported.

The changelog's dated section is the release-cut date written by `prepare`,
not the publication date; the workflow validates it through the helper's
historical mode, so environment approval crossing UTC midnight never fails a
valid release. The archived `release-automation` plan keeps its historical
record; a brief supersession note points readers at `RELEASING.md`.

## Acceptance Criteria

- A push to `main` with unchanged version completes green with no environment
  approval, no release secrets read, no tag, npm package, or GitHub release.
- A release-file-only version-changing merge to `main` triggers exactly one
  workflow run; the protected job runs only after approval and performs
  detection, tag creation/push, tag verification, npm verification/publication,
  and GitHub release in that one run; a tag push starts no second run.
- All release-detection rules (version change, stable semver, three-field
  agreement, changelog shape, exact three-file diff, greater-than, tag-target,
  exact triggering SHA) hold before any protected work; each failure mode
  fails closed with a diagnostic, and malformed or missing `before` is never
  treated as ordinary or as release.
- Only the release job references `environment: release`; only its steps access
  `RELEASE_*` secrets (App ID/key and GPG material); workflow permissions stay
  minimal
  (`contents: write`, `id-token: write` at workflow level, detection job
  narrowed to `contents: read`).
- Existing verification strength is preserved: exact-SHA full-history checkout,
  reachability from current `origin/main`, `npm ci`, format/lint/type-check/
  build/test/diff-check, generated-skill parity, clean source, changelog-derived
  notes, exact `npm pack --json --ignore-scripts` tarball, trusted npm publish
  with provenance, identity/integrity verification (already-published success
  only on exact match), and GitHub release create-or-update.
- GPG tag creation meets every signing requirement: isolated temp home,
  restrictive permissions, exact fingerprint match, configured Git identity,
  batch + loopback pinentry, no passphrase in logs/argv, mode-0600 passphrase
  file removed in `always()` cleanup, annotated signed tag at the exact
  triggering SHA with deterministic message, local verification before push,
  single non-force tag push via the App installation token, GitHub
  verified-signature
  confirmation before npm publication.
- Reruns are safe: absent remote tag creates/pushes once; existing remote tag
  is fetched and verified as the exact annotated signed tag at the triggering
  commit; mismatched existing tags fail without mutation; already-published npm
  version succeeds only on identity/integrity match; existing GitHub release is
  updated.
- Detection and tag-verifier tests cover every case listed under Testing; the
  full repository suite passes; workflow YAML passes the inspection checklist;
  the final diff contains no credential material.
- `RELEASING.md` documents the full procedure, setup, rerun/recovery/rotation,
  date semantics, and unsupported overlapping releases; `release:tag` remains
  available as break-glass; `prepare` and dry-run behavior unchanged; no
  `CHANGELOG.md` entry.

## Verification

Strategy only; results live in tests, CI, and PR review:

- Focused subprocess tests under `tests/integration/` for the detection script
  and the shared tag verifier, using temp git repos with bare local remotes and
  fixture signing (same harness as `release-utility.test.ts`); no live npm,
  GitHub, or real GPG secrets.
- Existing `tests/integration/release-utility.test.ts` stays green after the
  `release.mjs` delegation change, including `prepare` and `tag` dry-run tests.
- Workflow YAML inspection checklist: branch trigger only (no tag-trigger
  recursion), detection job without `environment:` and without secret refs,
  protected-environment placement only on the release job, `needs` output
  propagation, exact-SHA checkout and tag target, safe shell quoting, no secret
  output, idempotent rerun paths, pinned external actions, `always()` cleanup.
- Full suite, in order: `npm run format:check`, `npm run lint`, `npm run knip`,
  `npm run type-check`, `npm run build`, `npm test`, `git diff --check`;
  final `git status --porcelain` expected clean apart from intended changes.
- Final diff inspection for accidental credential material (no `RELEASE_*`
  values, keys, or passphrases) and `git diff --check`.

## Risks and Considerations

- `github.event.before` semantics: malformed or missing values fail closed;
  this makes the first push to a newly created default branch fail until a
  baseline commit exists.
- External setup is a hard dependency: the Release Automation GitHub App must
  be installed on `vipentti/planlet` with Contents read/write and added to the
  `v*` tag-ruleset bypass list; until the App is configured, no tag push can
  succeed.
- GPG signing depends on runner-local `gpg`; batch/loopback configuration is
  verified by local `git verify-tag` before any push, and a ruleset-rejected
  push fails the job clearly before npm publication.
- Rerun after a tag push but failed publication relies on the existing exact
  npm identity/integrity verification; a partial registry write that matches
  nothing can still require manual cleanup.
- Two release PRs merged before the first release completes are unsupported;
  the global `release-main` concurrency group serializes runs but cannot
  reconcile conflicting version bumps.

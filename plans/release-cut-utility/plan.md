# Release-cut maintainer utility

## Summary

Add a dependency-free maintainer script that collapses the still-manual
release-cut operator steps from `RELEASING.md` into two explicit subcommands:
`prepare` (changelog cut, version alignment, signed release commit, branch push,
and PR into `main`) and `tag` (annotated signed tag, optional push). Remote
publish stays with environment-gated `release.yml`. No auto-merge and no
auto-tag after merge.

Dry-run stays strictly non-mutating. `prepare` and `tag` each select **fresh**
vs **resume** before applying fresh-only checks. Resume validates existing
objects against invariants (never by predicting SHAs or recreating tags). The
assert helper is the sole changelog parser: historical verify derives or checks
the release date and exposes it through a stable machine-readable contract so
`release.mjs` never regex-parses the changelog. `tag` requires `HEAD` equal to
the current remote `main` tip. Prepare PR lookup distinguishes open, merged,
closed-unmerged, and conflicting PR states.

## Motivation

After release automation, humans still hand-edit release files, remember
`--release-date`, open the version PR, create a signed annotated tag, and push
it. Mistakes fail late in the workflow. A local script can make prepare and tag
deterministic and fail closed before irreversible remote publish, while keeping
PR review and the post-merge tag as deliberate human gates.

## Scope

In scope:

- New `scripts/release.mjs` (Node 22+, no new runtime deps) with subcommands
  `prepare` and `tag`.
- npm aliases only:
  - `release:prepare` → `node scripts/release.mjs prepare`
  - `release:tag` → `node scripts/release.mjs tag`
- Narrow extension of `scripts/assert-changelog-release-ready.mjs`:
  - historical verification mode that accepts already-recorded dates (no
    not-in-the-past rule);
  - optional/derived date handling with a stable machine-readable result (e.g.
    `--print-release-date` or a small stable JSON object) so `release.mjs`
    consumes the helper’s resolved date without parsing the changelog itself;
  - existing `--release-date` prepare-time semantics (including not-in-the-past)
    and ordinary CI mode unchanged.
- `prepare` fresh / resume (branch + commit invariants; PR state handling).
- `tag` fresh / resume (local annotated signed tag invariants; optional push;
  remote tag always investigation-required).
- Dry-run by default; mutations require `--execute`. `--push` is valid only on
  `tag` and still requires `--execute`. Prepare has no separate `--push`.
- Remote-ref probes distinguish found / absent / query-failed (do not treat
  every nonzero `git ls-remote --exit-code` as absent).
- Update `RELEASING.md` for the scripted operator path; leave workflow /
  trusted-publishing narrative authoritative for the remote job.
- Fixture / subprocess tests (temp repos, bare remotes, stubbed `gh` /
  signing). CI must not require live GitHub or real signing keys.

Out of scope:

- A single `npm run release` that mixes phases.
- `planlet release` or any product-CLI / skill / planlet-lifecycle change.
- Changing `.github/workflows/release.yml`, Environment `release`, tag rulesets,
  or npm trusted publishing.
- Auto-merge of the version PR; auto-reopen of closed PRs; automatic post-merge
  tag.
- Version selection / semver inference, changelog prose generation, prerelease
  channels, or direct `npm publish`.
- Force-updating, moving, or deleting tags or release branches.
- New runtime dependencies.
- Predicting/regenerating commit or tag object IDs for idempotency.
- Independent changelog regex/parsing inside `release.mjs`.
- Scraping unstructured assert stderr/stdout for dates.

## Approach

### Operator workflow

1. Fresh prepare on a clean checkout at the current remote `main` tip:
   `npm run release:prepare -- --version X.Y.Z` (dry-run), then `--execute`.
2. Human reviews and merges the opened PR into `main` (no auto-merge). Merge
   may land on a later UTC day than prepare.
3. After merge, on a clean checkout updated so `HEAD` equals the current remote
   `main` tip:
   `npm run release:tag -- --version X.Y.Z --execute` (local tag), then the same
   with `--push` when ready to publish the tag — or
   `… --execute --push` in one step. No remembered prepare-time date.

### Shared CLI rules

1. Parse subcommand first (`prepare` | `tag`). Shared flags: required
   `--version`, optional `--release-date`, `--execute`, `--help`. Tag-only:
   `--push`. Reject unknown flags and duplicate values consistently.
2. Never run `npm publish`, merge a PR, create a release tag during `prepare`,
   or perform worktree / index / remote-write / local-ref-write mutations during
   dry-run.
3. Subprocess failures name the failed operation and include enough stderr for
   recovery without echoing credentials.
4. Assert helper is the sole changelog parser/validator for release-date
   resolution. `release.mjs` only invokes it and consumes its stable
   machine-readable result. `changelog.mjs` remains available for notes smoke
   only, not as a competing date parser.

### Mutation classes (dry-run contract)

| Class | Examples | Dry-run | `--execute` |
| --- | --- | --- | --- |
| Remote read-only | `git ls-remote`, `gh` read APIs | Allowed | Allowed |
| Local Git metadata mutation | `git fetch`, writing `FETCH_HEAD` | Forbidden | Allowed when required; prefer `--no-write-fetch-head` where useful |
| Worktree / index mutation | editing files, `git add` / `commit`, creating local branches/tags | Forbidden | Allowed for intended steps |
| Remote mutation | `git push`, `gh pr create` | Forbidden | Allowed for intended steps |

Dry-run acceptance is mechanically testable: after dry-run, worktree, index,
and local refs (including remote-tracking refs) are unchanged aside from
process-ephemeral state outside the repo.

### Remote-ref probes (found / absent / failed)

Commands like `git ls-remote --exit-code --tags origin refs/tags/v<version>`
use nonzero status when the exact ref is absent. Absence is the normal “safe
to proceed / no remote object” result; network, auth, and other query failures
must stop execution.

Implementation must classify every probe of remote `main`, remote release
branch, and remote tag as exactly one of:

1. **Found** — exact ref present (parse the returned SHA; handle peeled
   annotated-tag lines carefully; match exact name only).
2. **Absent** — successful query proving the exact ref does not exist.
3. **Failed** — remote could not be queried (nonzero for reasons other than
   “ref missing”, empty unexpected output, transport errors). Fail closed;
   do not treat as absent.

Apply the same classification to release-branch and remote-main probes. Tests
must cover absent-ref vs inaccessible/broken remote.

### Remote `main` identity without false validation

- **Dry-run:** `git ls-remote origin refs/heads/main` with found/absent/failed
  handling. Compare local `HEAD` to the found SHA without `git fetch`. If
  identity cannot be proven from local objects, do not claim success.
- **`--execute`:** explicitly `git fetch` before mutations, then validate
  against the fetched tip.

### Assert helper contract (sole changelog parser)

Extend `scripts/assert-changelog-release-ready.mjs` (dependency-free, same Node
range). Modes are mutually exclusive where noted. Human-readable default output
and ordinary CI behavior stay unchanged unless a machine-readable flag is set.

| Mode | Used by | Behavior |
| --- | --- | --- |
| (default / CI) | existing ordinary CI | Unchanged |
| `--release-date D` | `prepare` | Unchanged strict prep: Unreleased + matching version section dated `D`, non-empty notes, `D` today-or-later UTC, equality. Not weakened. |
| Historical verify | `tag` (and prepare resume content checks as needed) | Validates empty Unreleased; exactly one matching package-version section; valid date; non-empty notes; **no** not-in-the-past. If operator/`release.mjs` passes an explicit date, require equality. If no date is passed, **derive** the section date. With an explicit machine-readable flag (e.g. `--print-release-date`) or small stable JSON result, print **only** the resolved date (or structured fields) on success — stable contract, not scraped diagnostics. |

`release.mjs` tag path:

1. Invoke historical verify (with optional `--release-date` / verify-date arg
   when the operator supplied one; otherwise let the helper derive).
2. Request the machine-readable resolved date.
3. Use that returned date for logging/docs only as needed; do not parse
   `CHANGELOG.md` itself.

Helper-level tests:

- derive and return a historical release date;
- explicit matching date accepted;
- explicit mismatch rejected;
- malformed or duplicate version sections rejected;
- stable machine-readable output format;
- ordinary CI and `--release-date` prep modes unchanged (including past-date
  rejection under `--release-date`).

### Release-date resolution (no parsing in `release.mjs`)

- **`prepare`:** `--release-date` defaults to today UTC; write that date into
  the new section; invoke assert with `--release-date <D>` (strict).
- **`tag`:** invoke historical verify via the helper; helper derives or checks
  `D`; `release.mjs` consumes the machine-readable result. Primary docs:
  `npm run release:tag -- --version X.Y.Z --execute` with no hidden date.

### `prepare` mode selection (before fresh-only checks)

Before fresh-run requirements, discover state for `--version`:

1. Local ref `refs/heads/release/v<version>` if present.
2. Remote exact branch probe (`found` / `absent` / `failed`).
3. PR lookup via `gh` covering **open, closed, and merged** PRs for head
   `release/v<version>` (must not query only open PRs, then accidentally create
   a replacement for a previously closed or merged release PR).

**Fresh preparation** — no corresponding local branch, remote branch, or
relevant PR (open/closed/merged) for that head:

- Require clean worktree and `HEAD ==` current remote `main` tip.
- Shared prechecks: version/date shape, `gh` auth, signing config.
- Then: edit files → create branch → signed commit → push → `gh pr create`.

**Resume preparation** — local branch, remote branch, and/or relevant PR
exists:

- Do **not** require `HEAD ==` remote `main`.
- Allow checkout on the matching release branch or inspect by ref.
- Require clean worktree.
- Validate existing release commit against invariants below.
- Finish only missing push/PR steps per PR-state rules. Never recreate the
  commit. Never delete/force-update branches.

### Release-commit invariants (resume identity)

After a commit exists, its **actual SHA** is the recovery identity. Validate:

1. Branch name exactly `release/v<version>`.
2. Exactly one parent (preparation base = that parent once other invariants
   pass; no hidden sidecars).
3. If remote `main` advanced: resume only when parent is still an ancestor of
   current remote `main`, content invariants still hold, and local/remote
   release tips agree; otherwise hard-refuse ambiguous cases.
4. Message exactly `release: <version>`.
5. Valid cryptographic signature under the project’s verification rule (CI
   stubs).
6. Committed release files match `--version`; changelog validated through the
   helper’s historical verify (helper derives/checks date) — not a third
   parser in `release.mjs`.
7. Release-files-only diff vs parent.
8. Local and remote tips, when both exist, agree on that SHA.

### Prepare PR lookup and state handling

Lookup must consider open, closed, and merged PRs for head branch
`release/v<version>`. Classify before creating any PR:

| PR state | Requirements | Behavior |
| --- | --- | --- |
| **Open matching** | Head branch exactly `release/v<version>`; head SHA equals validated release commit; base exactly `main`; state open | Report URL; no duplicate; success |
| **Merged matching** | Same head/base/SHA identity; merged | Report preparation already merged/complete; do not create another PR or push; success (distinct message) |
| **Closed, unmerged matching** | Same head identity; closed without merge | Hard-refuse; deliberate operator action required. Do not reopen or create a replacement (reopening out of scope) |
| **Conflicting** | Head branch matches but SHA differs; base ≠ `main`; multiple relevant PRs make intent ambiguous; other conflicting state | Hard-refuse |

“Missing PR” for create means: no open, closed, or merged PR relevant to that
head/base combination after the full lookup. Stubbed-`gh` tests cover each
state.

### Other prepare resume scenarios

| Observed state | Behavior |
| --- | --- |
| Local matching validated branch, no remote branch | Push that SHA; then apply PR-state handling |
| Remote matching validated branch, no local branch | Inspect/track without force; apply PR-state handling |
| Matching remote branch, no relevant PR after full lookup | Create PR only |
| Divergent local vs remote release branches | Hard refuse |
| Branch tip fails invariants | Hard refuse |
| Dirty tree before commit | Refuse; manual restore; no automatic reset |
| Remote `main` advanced; commit still validates; tips agree | Resume push/PR per rules above |
| Ambiguous main advancement / divergent tips | Hard refuse |

`prepare --execute` success: validated release commit on `release/v<version>`,
branch on `origin` when required, and either an open matching PR, or a merged
matching PR already completing preparation (reported distinctly).

### `tag` fresh vs resume

Shared preconditions for both modes: clean worktree; `HEAD ==` current remote
`main` tip; package version equals `--version`; historical changelog verify via
helper (machine-readable date); remote-tag probe classified found/absent/failed.

**Remote tag found** (exact `refs/tags/v<version>`): always hard-refuse
automatic action — investigation-required even if a matching local tag exists
(remote release state may already have been acted upon). Never force-move or
delete.

**Remote probe failed:** fail closed (do not proceed as absent).

**Fresh tag** — remote absent and no local tag:

- `--execute`: create annotated signed `git tag -a -s "v<version>" -m
  "v<version>"` at `HEAD`. Signing failure leaves no lightweight tag.
- Push only with `--push` (still requires `--execute`).

**Resume — existing local tag, remote absent:** do not reject solely because
the local tag exists. Validate exactly:

1. Name exactly `v<version>`;
2. Annotated tag object (not lightweight);
3. Valid signature under the project’s verification rule;
4. Points at exact current `HEAD`;
5. `HEAD` still equals current remote `main` tip;
6. Tag message exactly `v<version>`;
7. Package version + helper historical verify still pass.

Then:

- without `--push`: report valid local tag already exists; exit successfully
  (idempotent inspect-before-push workflow);
- with `--push --execute`: push only that exact validated tag ref;
- never recreate, move, delete, or force-update it.

**Invalid / conflicting local tag** (lightweight, unsigned, bad signature,
wrong target, wrong message, other invariant failure): hard-refuse.

### Documentation (`RELEASING.md`)

Document:

- prepare → review/merge → update-to-main-tip → tag[`--push`];
- helper-owned historical date derivation / machine-readable contract;
- fresh vs resume for prepare and tag;
- PR open / merged / closed-unmerged / conflicting handling;
- dry-run remote-read semantics and ls-remote found/absent/failed;
- deliberate local-tag-then-push workflow.

## Acceptance Criteria

- Dry-run: no worktree/index mutations, no local Git metadata mutations
  (including no `git fetch`), no remote mutations; remote read-only allowed;
  mechanically tested.
- Assert helper is sole changelog date parser; `release.mjs` consumes stable
  machine-readable output only; no changelog regex in `release.mjs`.
- `prepare` uses `--release-date` (rejects past). `tag` uses historical verify
  (earlier-day OK; mismatch rejected; date derived or checked by helper).
- Helper tests: derive/print date; match; mismatch; malformed/duplicate
  sections; stable machine-readable output; CI and prep modes unchanged.
- Fresh prepare: clean tree, `HEAD ==` remote main tip, signed commit, push,
  open PR.
- Prepare resume before fresh-only checks; commit invariants; never recreate
  SHAs; never delete/force-update branches.
- PR lookup includes open, closed, and merged; open matching → report success;
  merged matching → distinct already-complete; closed unmerged → refuse;
  conflicting / ambiguous → refuse; no silent replacement PR.
- Tag fresh/resume: local-only valid tag without `--push` idempotent; with
  `--push` pushes once; push-fail then retry validates and pushes; invalid
  local tag refused; remote tag hard refuse; no force/recreate.
- Remote-ref probes distinguish found / absent / failed for main, release
  branch, and tag; tests cover absent vs broken remote.
- `tag` requires `HEAD ==` remote main tip; stale after main advances refused.
- Strict flags; subprocess errors with operation + stderr, no credentials.
- `RELEASING.md` updated; remote job unchanged; CI fixtures only.

## Verification

Strategy only — results stay in suite, review, and CI:

```sh
npm run format:check
npm run lint
npm run type-check
npm run build
npm test
git diff --check
```

Focused cases: helper historical derive/print + prep/CI unchanged; dry-run
purity; fresh prepare; resume commit-without-push and push-without-PR; PR open /
merged / closed-unmerged / conflicting stubs; divergent branch refuse; tag
local-then-push resume; invalid local tag refuse; remote tag refuse; ls-remote
absent vs failed; stale main tip refuse; tag day later than prepare. Live
signing/`gh`/push remain operator gates. No `## Verification Evidence` unless
later required.

## Risks and Considerations

- Historical verify + machine-readable date export removes the
  “release.mjs must derive D without parsing” contradiction; scraping
  diagnostics would be fragile — the stable print/JSON contract is required.
- Tag local-create then push-fail is a normal failure; local-tag resume is
  load-bearing, just as prepare branch resume is.
- Remote tag presence remains non-resumable automatically: safer than guessing
  about GitHub Release / workflow side effects.
- PR state must be queried beyond open-only, or closed/merged releases get
  duplicate PRs.
- Treating every `ls-remote --exit-code` nonzero as “absent” would proceed
  under network failure — found/absent/failed classification is mandatory.
- Resume must not apply fresh `HEAD == main` (prepare) or “any local tag =
  refuse” (tag) checks blindly.
- Signing/`gh` are operator-dependent; CI stubs them.
- Tag push still waits on Environment `release`; script must not claim npm
  success.

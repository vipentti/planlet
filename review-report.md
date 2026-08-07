# Post-merge review: auto signed release machinery (PR #46, commit 73204de)

- Reviewer: fresh-set-of-eyes agent (not the implementer of #46).
- Reviewed state: `main` at `53e9464` ("refactor: modularize source layout into clustered folders (#49)"), which contains merge commit `73204de` (PR #46) plus the three follow-up release commits (`9fe8b96`, `f127cb3`, `da23e4d`, `1842b24`, `d37da85`, `5406a6f`, `4ed5d03`, `8ab9eee`, `c85fa89`, `47ac63d`, `bca3e6a`, `34b2cbe`, `d906f2c`, `eb3038c`, `8523f8a`, `5950368`, `8b9e387`).
- Review mode: read-only for the workflow. No tag pushed, no environment triggered/approved, no npm publish, no release secrets touched.
- Date (UTC): 2026-08-07.

## Verdict

**Safe to use for 0.3.0 — with one recommended hardening fix (Finding F1) shipped in the same change set as this review.**

The machinery is correct and fail-closed for the intended flow. The single finding that warrants a code change is defense-in-depth (registry-latest monotonicity), and it does not block 0.3.0 provided it lands before the release. Everything else is documentation/robustness or info-level.

## Method

Static review of `.github/workflows/release.yml`, `scripts/detect-release-merge.mjs`, `scripts/assert-changelog-release-ready.mjs`, `scripts/release.mjs`, `scripts/verify-release-tag.mjs`, `RELEASING.md`, `AGENTS.md` (release guidance), and the release-focused integration tests. Empirical verification in a disposable git worktree and `/tmp` scratch repos:

| # | Command / experiment | Result |
| --- | --- | --- |
| 1 | `node scripts/detect-release-merge.mjs --before <sha>` on current main | `{"isRelease":false}` (version unchanged → ordinary push) |
| 2 | Full release-merge simulation (0.2.0→0.3.0, cut changelog via `updateChangelogLinkReferences`, bump pkg+lock) in scratch clone | `{"isRelease":true,"version":"0.3.0"}` |
| 3 | Negative: version downgrade | fails: "New version 0.1.0 is not greater than previous 0.2.0." |
| 4 | Negative: version bump + extra file | fails: "Release merge must change exactly CHANGELOG.md, package.json, package-lock.json; found: EXTRA.txt, ..." |
| 5 | Negative: package.json bump without lockfile bump | fails: "package-lock.json.version is 0.2.0, expected 0.3.2" |
| 6 | Negative: non-empty `[Unreleased]` | fails: "[Unreleased] section must be empty for historical verification." |
| 7 | Negative: missing changelog link reference | fails: "Changelog is missing link reference(s): [0.2.0]." |
| 8 | Negative: local tag `v0.3.x` pointing at a different commit | detector refuses (tag collision rule, lines 265-274) |
| 9 | Generated ed25519 GPG key (primary + signing subkey), signed tag `v1.0.0` | reproduced GnuPG 2.4.4 `VALIDSIG` layout: `VALIDSIG <signing-fpr> <date> <timestamp> <expire> <sig-version> <reserved> <pubkey-algo> <hash-algo> <sig-class> [<primary-key-fpr>]` |
| 10 | `verify-release-tag.mjs` against the subkey-signed tag | correct primary fingerprint accepted (`{ok:true}`), wrong fingerprint rejected |
| 11 | Workflow inline `awk` VALIDSIG parser against the same raw output | extracts primary fingerprint correctly (`$12`) on gpg 2.4.4 |
| 12 | Public-key-only GNUPGHOME (fresh home, zero secret keys) verify of the tag | `GOODSIG`+`VALIDSIG` OK, exactly the public-only path the rerun uses |
| 13 | `npm test` (release-detection, release-tag-verify, release-utility) | 49/49 pass |
| 14 | `npx tsx --test tests/integration/release-workflow.test.ts` | 33/33 pass |
| 15 | Full-suite `format:check`, `lint`, `knip`, `type-check`, `build` | repo is green (see below) |

## Findings

| ID | Severity | Area | Finding | Evidence | Recommended fix |
| --- | --- | --- | --- | --- | --- |
| F1 | **Medium** | npm registry | The publish branch publishes the tarball unconditionally and never compares against versions already on the registry. If the registry already carries a **higher** stable version than `VERSION` (e.g. an out-of-band manual publish, or a previous release whose tag/commit was rolled back), the job would publish the lower version and npm moves the `latest` dist-tag **backward** — silently downgrading all new `npm install @vipentti/planlet` consumers. The "already-published same version" path is correctly handled (verify-only), but a *higher, different* version is not. | `release.yml` lines 749-772: `elif grep -q "E404" ...; then npm publish ...` with no pre-publish registry-version comparison. The detector only proves the bump over the previous repo commit (`detect-release-merge.mjs` lines 183-187), never over published npm versions. | Before publishing in the E404 branch, run `npm view ${PACKAGE_NAME} versions --json` and **refuse** when any stable published version is greater than `VERSION`. Fail closed on non-E404 registry errors. (Shipped in this review's PR.) |
| F2 | **Low** | GPG tag verification | VALIDSIG positional parsing is tied to GnuPG's status layout. Verified correct on the runner's gpg **2.4.4** for both primary-signed and subkey-signed tags (findings 9-11). On older gpg (2.2) the layout differs (13 data fields; primary fpr at field 7, signer_fpr last): the workflow's `$12` and `verify-release-tag.mjs`'s `fields.at(-1)` would misparse. Impact is **fail-closed only** (a non-40-hex field or a subkey fpr never equals the expected primary fpr), so there is no false-accept path — the risk is availability: a format drift on `ubuntu-latest` would brick the release, and break-glass `release.mjs tag` on a maintainer machine with gpg <2.4 would false-reject a subkey-signed tag. | `release.yml` lines 627-638 (`primary=$12`); `verify-release-tag.mjs` lines 28-48. GnuPG 2.4 `DETAILS`: `VALIDSIG <fpr> <date> <timestamp> <expire> <sig-version> <reserved> <algo> <hash> <sig-class> [<primary-fpr>]`. | Do not add untested cross-version parsing. Document the pinned gpg expectation at both parse sites and note the fail-closed property (comment-only; shipped in this review's PR). Optionally pin/document the runner image gpg version in RELEASING.md. |
| F3 | Info | Version chain | `verify` job uses `node-version: 22` (floating patch) while the `release` job pins exact `24.11.1`/`11.6.2`. The published artifact is **built** in `verify` with Node 22.x; the release job's pinned toolchain only runs npm publish/view. Node 22 patch drift across releases is possible but each release's artifact is validated (build, tests, smoke) in `verify`. | `release.yml` lines 98-101 vs 276-288. | None required. Aligning `verify` to an exact Node pin would be a minor consistency improvement, not a fix. |
| F4 | Info | Changelog | Current main has a stale link target `[Unreleased]: .../v0.1.2...HEAD` (should be `v0.2.0`). Pre-existing, not produced by the reviewed machinery; the detector validates link **presence**, not targets. Self-heals at next `release:prepare` (rewrites `[Unreleased]` and the new version link from the previous version). | `CHANGELOG.md` lines 93-94. | None. |
| F5 | Info | Token handling | `github.token` is injected into `git` CLI arguments (`-c http.https://github.com/.extraheader=...`) in the fetch steps, so it is visible in process listings during those steps. Standard GitHub Actions practice; the token is ephemeral and job-scoped. | `release.yml` lines 92, 251, 266, 562. | None. |
| F6 | Info | Availability | Polling windows are short: 5×6s for GitHub tag-signature verification and 10×6s for npm packument visibility. A slow registry/GitHub could spuriously fail the run; recovery is a rerun, which takes the verify-only path. | `release.yml` lines 697-714, 755-766. | None. |

## Known concern (VERSION env vs package.json.version): CLOSED

Traced every downstream use of `VERSION` (detect output):

- `verify` job: `Validate reviewed package artifact` asserts the pack filename equals `vipentti-planlet-${VERSION}.tgz` **and** the extracted `package.json.version === VERSION` (`release.yml` lines 147-148, 163). npm names the tarball from the workspace's real `package.json`, so any mismatch between `VERSION` and the checked-out `package.json.version` fails here, before upload. The smoke test also re-asserts `planlet --version === VERSION`.
- `release` job, before any mutation: `Revalidate protected release contract` asserts `package.json.version`, `package-lock.json.version`, and root `packages[""].version` all equal `VERSION`, plus name identity and an exactly-three-file diff (`release.yml` lines 434-440, 450-454). `Validate downloaded package artifact` re-asserts filename + extracted version (`release.yml` lines 341-366).
- npm: `verify_registry` compares `registry.version === source.version`, where `source` is the workspace `package.json` whose version was already pinned to `VERSION` by the contract step (`release.yml` lines 737-740).

There is no use of `VERSION` in a mutation that is not preceded by a re-assertion against the actual checked-out content. A `VERSION` mismatch anywhere fails before tag creation or npm publish. **No residual hole.**

## Scope-by-scope verdicts (no finding unless noted)

| Scope area | Result |
| --- | --- |
| Detector rules + fail-closed (malformed/missing before-SHA, non-semver, non-increasing, extra files, changelog defects, tag collision) | **No finding.** All verified empirically (findings table rows 2-8). Zero-SHA and unresolvable before-SHA fail closed (`detect-release-merge.mjs` lines 130-143). |
| Version consistency chain incl. known concern | **No finding** (see above). |
| Rerun semantics: existing remote tag (verify-only, public key only), already-published npm version (identity/integrity verify), existing GitHub release (update) | **No finding.** Tag-exists path imports only the public key, asserts no secret key present, and verifies the exact annotated tag (type/target/subject/signature/object SHA) without mutation (`release.yml` lines 468-503, 659-663). Published npm version is verified for name/version/repository/gitHead/integrity; any mismatch fails without overwriting (`release.yml` lines 727-746). Existing GitHub release is updated via `gh release edit`. |
| TOCTOU: ancestry + release-intent re-checks after approval and immediately before tag creation | **No finding.** Three gates: after approval (`release.yml` 242-255), release-intent diff (`257-274`), and the final intent re-check immediately before App-token generation and tag push (`553-570`). Tag target is hardcoded to `GITHUB_SHA`; the residual window (push of an already-verified commit) is acceptable. Note: the tag-exists rerun path skips the release-intent diff — reasonable, since the irreversible mutation (tag) already exists and content/identity are re-asserted by the contract + artifact steps. |
| Break-glass `release:tag` path + fingerprint verification | **No finding.** Refuses existing remote tag, requires clean worktree + HEAD == remote main, resolves the changelog date via historical mode, requires `RELEASE_GPG_FINGERPRINT`, verifies the created tag through `verify-release-tag.mjs` (validated empirically), pushes only with `--push`, and verifies the remote object. |
| Documentation truth (RELEASING.md vs workflow; AGENTS.md) | **No finding.** RELEASING.md matches the workflow: three-job split, unprivileged `verify` with no OIDC, protected job executes no repository-owned scripts / `node_modules`, public-key-only rerun, App-token lifecycle (never copied to outputs/env/files/logs/URLs), environment main-only + required-reviewer requirements, tag ruleset guidance (creation bypass only, immutability never bypassed). Tag pushes do not re-trigger the workflow (`on: push: branches: [main]` only). |
| Trust boundaries (only `release` job holds `contents: write` / `id-token: write`; no project code or node_modules in the protected job) | **No finding.** Audited every step of the `release` job: it runs `actions/*` (pinned), inline bash, inline `node --input-type=module` code owned by the workflow, and system tools (`git`, `gpg`, `gh`, `jq`, `tar`, `npm`). No `npm ci`, no build, no repository script invoked. `npm publish` uses `--ignore-scripts` on the already-validated tarball. `detect` and `verify` run repo code but hold `contents: read` only, no OIDC, no secrets. |
| GPG key material (isolated GNUPGHOME, public-only rerun, private key/passphrase never loaded when a tag exists, fingerprint verification, `always()` cleanup) | **No finding.** `mktemp -d` + `chmod 700` home; secrets referenced only in their own step envs (verified by grep); public path asserts zero secret keys; both paths count exactly one primary key and verify the fingerprint; wrapper uses `--pinentry-mode loopback --passphrase-file`; `if: always()` cleanup removes the home and passphrase file. |
| GitHub App token (scoping, single-use, revocation) | **No finding.** `owner: repository_owner`, `repositories: planlet`, `permission-contents: write`; consumed only by the tag-push step; not copied to `GITHUB_OUTPUT`/`GITHUB_ENV`/files/logs/URLs (verified by grep — the only `GITHUB_ENV` writes are `PACKAGE_TARBALL`, `GNUPGHOME`, `TAG_OBJECT`, none secret); create-github-app-token revokes in its post step. |
| Environment hardening (main-only, required reviewer, post-approval re-checks) | **No finding.** Documented as live-Environment requirements; workflow re-checks ancestry + release-intent after approval. |
| npm: provenance, `--ignore-scripts`, tarball SHA-256/integrity revalidation | **No finding.** Provenance only possible in the `release` job (`id-token: write`); `--ignore-scripts` on pack and publish; downloaded artifact SHA-256 re-asserted against the `verify` output and its sha512 against `pack.json` integrity; published artifact's `dist.integrity` must equal the same integrity. |
| Action pins, `persist-credentials: false`, toolchain pins | **No finding.** All actions SHA-pinned with version-tag comments; both checkouts use `persist-credentials: false`; release job asserts exact `node v24.11.1` + `npm 11.6.2`; `package-manager-cache: false`. |
| Tag rulesets guidance in RELEASING.md | **No finding.** Creation bypass only; immutability ruleset (restrict updates/deletions, block force pushes) with no App bypass, explicitly. |

## Residual risks (accepted, documented)

- **Overlapping version bumps** are unsupported (documented). `concurrency` serializes runs but a second release PR merged during the first's approval queue will simply wait; the second run's `detect` sees the first release commit as its `before`, which is fine.
- **Manual npm intervention** is the only realistic trigger for F1; the guard closes it.
- **gpg format drift** (F2) fails closed, never false-accepts.

## Recommended action

1. Ship the F1 registry-version guard (implemented in this review's PR).
2. Add the F2 parse-site documentation comments (included in the same PR).
3. No other changes required. 0.3.0 may proceed once the PR is merged (or, if the maintainer accepts the residual risk, immediately — F1 cannot be triggered by the normal flow).

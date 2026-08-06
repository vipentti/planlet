# Tasks: Auto Signed Release

- [x] T1 Implement `scripts/detect-release-merge.mjs`: `--before` required,
      `--after` optional (default `HEAD`, must equal `HEAD` when passed);
      read before-state via `git show <before>:<path>` and after-state from the
      worktree; output exactly one JSON line (`isRelease:false` or
      `isRelease:true` + `version`); fail nonzero with a stderr diagnostic when
      `before` is missing, non-hex, all-zero, or unresolvable, when `after` does
      not equal `HEAD`, or when any release rule fails; classify a version-
      changing push as a release only when ALL hold: `package.json.version`
      changed; new version is valid stable `X.Y.Z` semver (numeric segments,
      no prerelease/build); the three root version fields agree; the changelog
      helper historical mode passes (one valid dated `[new version]` section,
      empty `[Unreleased]`, non-empty notes) via a spawned
      `assert-changelog-release-ready.mjs --verify-release --print-date`; the
      diff from `before` to `after` is exactly `CHANGELOG.md`, `package.json`,
      `package-lock.json`; new version is greater than previous (numeric
      compare); and `v<version>` is absent or points at the after commit;
      unchanged version returns `isRelease:false`; ambiguous states never
      silently succeed as ordinary
- [x] T2 Add focused subprocess tests for the detection script covering:
      ordinary main push with unchanged version; valid release-file-only version
      bump; package/lockfile version mismatch; malformed semver; downgrade and
      unchanged version; non-release file included in a version-changing merge;
      missing, malformed, and unresolvable previous SHA; invalid or nonempty
      changelog state; existing expected tag (same commit succeeds);
      existing tag pointing to another commit fails; all refusals exit nonzero
      with diagnostics; no live network, npm, or GitHub operations
- [x] T3 Add `scripts/verify-release-tag.mjs` (`--tag`, `--target`,
      `--message`): require annotated tag object, exact target commit, exact
      message subject, and successful `git verify-tag`; print the tag object
      SHA on success; nonzero with diagnostics otherwise; add focused
      subprocess tests (valid signed annotated tag, lightweight tag refused,
      wrong target refused, wrong message refused, missing signature refused);
      refactor `scripts/release.mjs` existing-local-tag validation and fresh-tag
      post-creation verification to delegate to it (message `v<version>`,
      target `HEAD`) while keeping all other `tag` guards, `prepare` behavior,
      dry-run defaults, and explicit non-force push/remote-verification logic;
      update fixture setup in `tests/integration/release-utility.test.ts` so
      temp repos copy the new helper; existing release-utility tests stay green
- [x] T4 Rewrite `.github/workflows/release.yml`: trigger only on `push` to
      `main` (no tag trigger, so pushing the release tag cannot start a second
      run); workflow permissions `contents: write` + `id-token: write`;
      `concurrency` group serializing main pushes without cancel; add
      unprotected `detect` job (no `environment:`, no `RELEASE_*` secret or
      token refs, permissions narrowed to `contents: read`) that checks out
      with full history, runs the detection script with
      `--before "${{ github.event.before }}" --after "$GITHUB_SHA"`, and sets
      `is-release`/`version` outputs; add protected `release` job that
      `needs: detect`, runs only when `is-release == 'true'`, is the only job
      with `environment: release`, and checks out `ref: ${{ github.sha }}` with
      full history; preserve the existing verification chain (reachability from
      freshly fetched `origin/main`, `npm ci`, format:check, lint, type-check,
      build, test, `git diff --check`, generated-skill parity, clean-source
      check, changelog release-notes extraction, `npm pack --json
      --ignore-scripts`, trusted npm publish with provenance, exact
      identity/integrity rerun verification, GitHub release create-or-update);
      replace the strict `--release-date "$(date -u ...)"` first-publication
      gate with the helper's historical mode so approval crossing UTC midnight
      never fails a valid release; add GPG signing steps (temp GNUPGHOME mode
      700, passphrase file mode 0600, import of `RELEASE_GPG_PRIVATE_KEY`,
      exact `RELEASE_GPG_FINGERPRINT` match, batch + loopback pinentry wrapper,
      `git config` name/email/signingkey from `RELEASE_GIT_NAME`/
      `RELEASE_GIT_EMAIL`/fingerprint, no passphrase in logs or argv);
      add exact-tag ensure step (absent remote: `git tag -a -s` at
      `$GITHUB_SHA` with message `Release v<version>`, local verification via
      the inline Git verifier, single non-force push of only that ref with a
      short-lived GitHub App installation token (pinned
      `actions/create-github-app-token`, scoped to `planlet` with Contents
      write only, generated only when the remote tag is absent) via
      temporary `GIT_CONFIG_*` basic-auth extraheader, remote ref re-verified;
      existing remote tag:
      fetch exact ref, verify annotated/exact commit/message/signature via the
      inline Git verifier, mismatched state fails without mutation); add GitHub
      tag-object `.verification.verified == true`
      confirmation with small bounded retry before npm publication; add
      `always()` cleanup removing the passphrase file and GNUPGHOME; keep
      external actions pinned to the existing reviewed SHAs; inspect the YAML
      for correct output propagation, protected-environment placement, secret
      access only in the protected job, exact-SHA tagging, no tag-trigger
      recursion, safe shell quoting, no secret output, idempotent reruns, and
      pinned actions
- [x] T5 Update `RELEASING.md`: normal flow is 1) `release:prepare`, 2) review
      and merge the release PR, 3) inspect the pending workflow deployment,
      4) approve the `release` environment, 5) verify the signed tag, npm
      package/provenance, and GitHub release; document all environment secrets
      and variables by exact name, dedicated release-only GPG key with
      GitHub-verified email, Release Automation GitHub App installed only on
      `vipentti/planlet` with Contents read/write and added to the existing
      `v*` tag-ruleset bypass list, ruleset prohibition of
      updates/force/deletes, short-lived per-run installation tokens, a
      maintainer PAT as last-resort manual recovery only, rerun behavior,
      `release:tag` break-glass recovery (no longer the normal happy path),
      high-level key rotation, unsupported overlapping release PRs, and that
      the changelog date is the release-cut date rather than the publication
      date; add a
      brief supersession note to the completed `release-automation` plan
      pointing at `RELEASING.md` without rewriting task evidence; verify
      referenced paths resolve; no `CHANGELOG.md` entry (maintainer tooling)
- [x] T6 Run the full verification gate: `npm run format:check`, `npm run lint`,
      `npm run knip`, `npm run type-check`, `npm run build`, `npm test`,
      `git diff --check`; run the focused detection and tag-verifier tests and
      the existing release-utility dry-run tests (`prepare` and `tag` dry-runs
      mutate nothing); inspect the workflow YAML against the T4 checklist;
      inspect the final diff for accidental credential material; confirm only
      intended files changed

## Completion

- Completed at: 2026-08-05T16:46:18.614Z
- Mode: normal

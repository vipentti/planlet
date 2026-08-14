# Tasks: Migrate planlet release to npm-release-flow kit

- [x] T1 Add kit pin and release:verify via skills:update
- [x] T2 Provision repository-level NPM_RELEASE_FLOW_* (owner/manual — GPG private/public + passphrase + App PEM; local check needs NPM_RELEASE_FLOW_APP_PRIVATE_KEY + NPM_RELEASE_FLOW_GPG_FINGERPRINT + signing preflights)
- [x] T3 Confirm Trusted Publishing for release.yml
- [x] T4 Replace release.yml with thin reusable caller and delete workflow-coupled tests
- [ ] T5 Ship 0.5.1 via kit prepare
- [ ] T7 Post-0.5.1 cleanup: delete legacy RELEASE_* environment secrets/variables + final bookkeeping (source ownership already pulled into this PR at ddca69d/3cb11b0/this revision — scripts, knip entries, shrunk assert-changelog-release-ready.mjs, RELEASING/AGENTS rewrites)

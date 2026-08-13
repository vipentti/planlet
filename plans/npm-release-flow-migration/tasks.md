# Tasks: Migrate planlet release to npm-release-flow kit

- [ ] T1 Add kit pin and release:verify via skills:update
- [ ] T2 Provision repository-level NPM_RELEASE_FLOW_* (owner/manual — GPG private/public + passphrase + App PEM; local check needs NPM_RELEASE_FLOW_APP_PRIVATE_KEY + NPM_RELEASE_FLOW_GPG_FINGERPRINT + signing preflights)
- [ ] T3 Confirm Trusted Publishing for release.yml
- [ ] T4 Replace release.yml with thin reusable caller and delete workflow-coupled tests
- [ ] T5 Ship 0.5.1 via kit prepare
- [ ] T7 Migration cleanup after 0.5.1

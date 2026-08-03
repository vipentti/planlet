# Tasks: Launch Readiness

- [x] T1 Add per-planlet write lock module and integrate into task update and completion; skip audit rollback on failed move; update design concurrency wording
- [x] T2 Add deterministic lock concurrency and cleanup tests (task/task, task/complete, acquire failure, throw cleanup, no lost updates)
- [x] T3 Reject completed normal-mode planlets with unchecked tasks as invalid_plan; cover unit and compiled CLI
- [x] T4 Make harness destination install transactional with fault-injection restore tests; resolve only selected harness adapters
- [x] T5 Add production internal_error boundary with optional PLANLET_DEBUG; pin CI action SHAs; add Dependabot; gate changelog 0.1.0 date and document bootstrap procedure
- [x] T6 Make planlet locks ownership-token safe with quarantine rename reclaim and portable dead-PID detection
- [x] T7 Split changelog gate into ordinary CI mode and explicit --release-date verification; update README
- [x] T8 Add harness install commit point so post-commit cleanup failures never roll back published skills
- [x] T9 Include safely coalesced unselected harness aliases without resolving escaping unselected paths
- [x] T10 Extract owned-fs-lock helpers; conservative PID probe; wrap lock release/quarantine/mkdir errors
- [x] T11 Harness rollback recovery leaves bak/tx; refuse leftover recovery dirs on retry; structured write_conflict details
- [x] T12 Serialize harness installs with repository-wide __harness__ lock; nested install write_conflict tests
- [x] T13 Ordinary changelog requires exactly one Unreleased; shared date/notes helper; ponytail cuts
- [x] T14 Full verification, commit, push launch-readiness, refresh PR #6 description

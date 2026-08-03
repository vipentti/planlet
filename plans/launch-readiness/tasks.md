# Tasks: Launch Readiness

- [x] T1 Add per-planlet write lock module and integrate into task update and completion; skip audit rollback on failed move; update design concurrency wording
- [x] T2 Add deterministic lock concurrency and cleanup tests (task/task, task/complete, acquire failure, throw cleanup, no lost updates)
- [x] T3 Reject completed normal-mode planlets with unchecked tasks as invalid_plan; cover unit and compiled CLI
- [x] T4 Make harness destination install transactional with fault-injection restore tests; resolve only selected harness adapters
- [x] T5 Add production internal_error boundary with optional PLANLET_DEBUG; pin CI action SHAs; add Dependabot; gate changelog 0.1.0 date and document bootstrap procedure

# Tasks: Reject multiline task continuation

- [x] T1 Enforce strictly adjacent continuation check in validatePlanletStructure for active planlets only, after parseTasks, covering only silently accepted followers with parser precedence preserved
- [x] T2 Add unit tests for adjacent rejection with two-space, one-tab, and plain nested-bullet followers, parser precedence for task-like lines, single-line validity, and ordinary Markdown allowance
- [x] T3 Reuse tests/integration/task-update.test.ts via a blank-line-separated MARKDOWN fixture and add CLI integration asserting active validate returns invalidPlan exit 3, with completed-archive regression for validate --all
- [x] T4 Document one-line task grammar in planlet_design.md 10.4 and skills/planlet-plan/assets/tasks-template.md, update README if it describes task syntax (it does not today), add CHANGELOG.md [Unreleased] entry, and regenerate installed skill copies

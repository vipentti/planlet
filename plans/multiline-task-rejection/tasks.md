# Tasks: Reject multiline task continuation

- [ ] T1 Enforce strictly adjacent continuation check in validatePlanletStructure for active planlets only, leaving parseTasks unchanged as line-oriented syntax parsing
- [ ] T2 Add unit tests for adjacent rejection covering two-space, one-tab, and nested-bullet followers, plus single-line validity and ordinary Markdown allowance
- [ ] T3 Preserve task check and uncheck atomic rewrite and add CLI integration asserting active validate returns invalidPlan exit 3, with completed-archive regression for validate --all
- [ ] T4 Document one-line task grammar in planlet_design.md 10.4, skills/planlet-plan/assets/tasks-template.md and README, add CHANGELOG.md [Unreleased] entry, and regenerate installed skill copies

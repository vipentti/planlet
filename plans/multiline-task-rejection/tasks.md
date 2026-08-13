# Tasks: Support soft-wrapped task descriptions

- [x] T1 Implement indented paragraph-continuation consumption and whitespace normalization in parseTasks, removing the adjacent rejection check, while preserving TASK_LIKE_LINE_PATTERN precedence
- [x] T2 Add Prettier regression tests: wrap a long single-line task with proseWrap always and assert normalized parsing, tasks output, and block boundary handling including nested bullet and blank line cases
- [x] T3 Verify byte-preserving task check and uncheck on wrapped tasks and keep CLI integration covering valid wrapped validate, tasks output, nested checkbox parser error, completed archive and single-line validity
- [x] T4 Document soft-wrap grammar in planlet_design.md 10.4 and skills/planlet-plan/assets/tasks-template.md, update CHANGELOG.md, and regenerate installed skill copies

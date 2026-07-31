# Exceptional Evidence Policy

## Summary

Narrow the verification-evidence convention introduced earlier on this branch. A
`## Verification Evidence` section becomes exceptional and absent by default, and anything it does
record must be stable and effectively write-once.

## Scope

- Canonical skills under `skills/` and their reference guidance and templates.
- Generated harness copies under `.agents/skills` and `.claude/skills`, regenerated with the built
  project CLI.
- Contract wording in `planlet_design.md`, `README.md`, and `AGENTS.md`.
- Skill contract and scenario coverage for the narrowed policy.
- The evidence example inside the planlet archived earlier on this same branch.

## Out of Scope

- Any new CLI command, evidence schema, model field, error code, database, or third plan file.
- Changes to the CLI-generated `## Completion` record, which stays lifecycle-only.
- Retroactive normalization of the nine planlet archives that predate this branch.
- The pull-request description, which the pipeline updates during the final validation run.

## Approach

Evidence is absent by default. A note is permitted only when a durable fact is genuinely necessary
and cannot be reconstructed adequately from ordinary Git, test, pull-request, or CI history:
external, irreversible, non-reproducible, failed, partial, or unavailable verification whose
residual result affects a future decision. Routine tests, lint, type-checking, builds, ordinary
pull-request review, and branch-protected CI are sufficient in their own systems and are not
duplicated into committed task files.

Anything recorded must be write-once. A committed line must not contain a current-head or
self-referential commit SHA, a moving branch, `latest`, or dashboard link, a bare run identifier, a
transient log or output, a local path, or any fact that needs editing as later commits land. Prefer
a final artifact version or digest, or a stable external record, and only when material. A provider
record that already binds to its source does not need a duplicate SHA.

The planlet archived earlier on this branch carries an evidence section that the narrowed policy
would not permit: it duplicates routine local checks and anchors them to a commit SHA that was
current at the time of writing. Because that archive is introduced by this same pull request rather
than inherited history, the conservative handling is to delete only that superseded example, leaving
its tasks, plan, and CLI completion record untouched. The archive then demonstrates the new default,
which is no evidence at all, and this pull request stops presenting the superseded expectation as
the recommended example. Archives that predate this branch are left exactly as they are.

## Acceptance Criteria

- `planlet-plan` guidance states that evidence is exceptional and absent by default, and that
  routine check results stay in their native systems.
- `planlet-implement` guidance permits a note only for a durable fact that ordinary history cannot
  reconstruct, and names the write-once prohibitions, including self-referential or current-head
  SHAs.
- `planlet-complete` guidance states that a missing evidence section is normal and never blocks
  completion.
- `planlet_design.md`, `README.md`, and `AGENTS.md` describe one unambiguous policy, with no
  remaining wording that expects routine results or universal SHA anchors.
- The planlet archived earlier on this branch contains no evidence section, while its tasks and
  completion record are unchanged.
- Skill contract and scenario coverage asserts the narrowed policy and fails if the superseded
  universal-anchor wording returns.
- `.agents/skills` and `.claude/skills` remain byte-identical to canonical sources.

## Verification

- Local: repository commands `npm run format:check`, `npm run lint`, `npm run type-check`,
  `npm run build`, and `npm test`, plus `git diff --check` and `git status --porcelain`.
- Generated-skill parity: `node dist/planlet.mjs update --tools all` followed by
  `git diff --exit-code -- .agents .claude`.
- Planlet self-check: `node dist/planlet.mjs validate --all`, which must keep every archive valid.
- These are routine repository checks; under the policy this planlet introduces, their results stay
  in the test, lint, and CI systems that already hold them.

## Risks and Considerations

- Narrowing an in-flight convention on the same branch means both wordings exist in the branch
  history. Reviewers read the final state, so the contract must be unambiguous at the tip.
- Deleting the superseded example touches an archived planlet. It is limited to free-form prose
  added by this branch; task lines and the completion record are not modified.

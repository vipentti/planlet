# PR template agent guidance

## Summary

Require agents, via `AGENTS.md`, to follow `.github/pull_request_template.md`
when creating pull requests against this repository.

## Outcome

Every agent creating a pull request against this repository follows
[`.github/pull_request_template.md`](../../.github/pull_request_template.md),
because `AGENTS.md` requires it. The template exists (added in #14) but no
agent-facing instruction references it, so agents can open PRs that ignore it.

## Scope

- Add one short "Pull requests" section to `AGENTS.md` that:
  - requires using `.github/pull_request_template.md` as the PR body structure,
  - keeps the description proportional and removes non-applicable sections,
  - checks only the verification items actually run.

## Exclusions

- No changes to canonical or installed skills; skills never create pull
  requests.
- No changes to the pull request template itself.
- No CI or CLI enforcement of template use.

## Approach

Single documentation edit in `AGENTS.md`, placed near the working rules so
agents encounter it with the rest of their operating instructions. This PR
itself follows the template as a demonstration.

## Acceptance Criteria

- `AGENTS.md` references `.github/pull_request_template.md` and the referenced
  path exists.
- Markdown conventions hold (H1 intact, no unintended diff content).
- The change ships with this planlet completed and archived.

## Verification

Markdown-only change; per `AGENTS.md`:

- Confirm the referenced template path exists.
- Run `git diff --check`.
- Confirm the diff contains only the intended `AGENTS.md` addition.

## Risks

- Low: instruction could drift from the template over time. Mitigated by
  pointing at the template file instead of duplicating its content.

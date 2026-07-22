# Scaffold Generic Codex Skills

## Summary

Expose the canonical Planlet skills to Codex through the repository-level `.agents/skills/` discovery path while keeping `skills/` as the authoritative source.

## Scope

- Add Codex UI metadata to each canonical Planlet skill.
- Install ordinary file copies of the three complete canonical skill trees under `.agents/skills/`.
- Keep the installed copies byte-for-byte aligned with their canonical sources.

## Out of Scope

- Git commits.
- Symlinks, CLI installer logic, or harness-specific command adapters.
- Icons, brand colors, tool dependencies, or invocation-policy overrides.
- Changes to the existing skill workflows beyond their UI metadata.

## Approach

Generate an `agents/openai.yaml` file for each existing skill with `display_name`, `short_description`, and a one-sentence `default_prompt` that explicitly invokes the skill. Copy each complete canonical skill directory from `skills/` to `.agents/skills/` as ordinary files so Codex can discover the repository-local workflows. Treat `skills/` as authoritative and verify exact parity after installation.

## Acceptance Criteria

- The three canonical Planlet skills each contain valid OpenAI UI metadata.
- `.agents/skills/` contains complete ordinary-file copies of `planlet-plan`, `planlet-implement`, and `planlet-complete`.
- Installed skill files match their canonical counterparts byte-for-byte.
- No Git commit is created.

## Verification

Run the skill-creator validator on the canonical and installed skill directories. Check exact tree parity, frontmatter, metadata constraints, relative references, planlet structure, and `git diff --check`.

## Risks and Considerations

The installed copies can drift if canonical skills are edited manually. Until installer automation exists, future canonical changes must be recopied and parity-checked. Codex may require a refresh or restart before a running session displays newly installed skills.

---
name: planlet-complete
description: Validate and safely complete or archive exactly one active repository-local Planlet with a UTC audit record. Use when a user asks to finish the Planlet lifecycle, archive completed work, or explicitly override incomplete tasks with a recorded reason.
---

# Planlet Complete

Complete one planlet without hiding unfinished or invalid work.

## Start the workflow

1. Discover the repository root without traversing above its boundary.
2. Determine whether the required `planlet` validate, tasks, and complete operations are available. Prefer them whenever present; the CLI remains non-interactive and owns deterministic checks and movement.
3. If any required operation is unavailable, announce the narrow repository-local fallback and name the CLI validation, completion, or collision checks that cannot run.
4. Resolve exactly one active planlet. Accept one valid explicit slug. With no slug, select and announce the sole active planlet; report none when none exist; ask the user to choose when several exist.
5. Re-read both files completely and validate structure. Treat a missing, unreadable, or malformed file as invalid, never as completed.

## Decide completion

Inspect all recognized tasks. For normal completion, require every task to be checked. If tasks remain, show their IDs and descriptions, warn that completion will archive unfinished work, and obtain explicit confirmation plus a non-empty reason. Do not reuse general implementation approval as an override.

Read [completion guidance](references/completion-guidance.md) before performing manual completion. Refuse unsafe paths, invalid slugs, an existing completed planlet with the same logical slug, or an occupied destination. Do not change the source when any check fails.

When the CLI complete operation is available, delegate normal or explicitly approved incomplete completion to it and inspect the result. Otherwise capture one UTC instant, append the required completion record to `tasks.md`, derive the archive date from that same instant, revalidate the source and destination, and move the whole directory to `plans/completed/<YYYY-MM-DD>-<slug>`.

Do not implement remaining tasks, complete several planlets, overwrite a destination, change the logical slug, or delete either primary file.

## Finish

Report the logical slug, recorded UTC timestamp, normal or incomplete-override mode, remaining task IDs for an override, and final archive path. If the operation stopped, report the exact unchanged source and blocking check. When fallback was used, repeat which deterministic CLI checks were unavailable.

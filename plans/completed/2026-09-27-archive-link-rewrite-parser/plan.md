# Archive Link Rewrite With a Markdown Parser

## Summary

`planlet complete` moves `plans/<slug>/` to `plans/completed/<date>-<slug>/`,
one directory deeper. Relative links and images in `plan.md` and `tasks.md`
that point outside the planlet then resolve one level too shallow and break.
This planlet makes completion rewrite those destinations by prepending `../`,
using a CommonMark parser to find the exact destination byte ranges instead of
a hand-written scanner.

The parser is `mdast-util-from-markdown` (micromark), bundled into
`dist/planlet.mjs` as a devDependency. The published package keeps zero
runtime `dependencies`. The choice rests on a throwaway probe, summarized below.

## Evidence

**Closed attempt.** Pull request https://github.com/vipentti/planlet/pull/99
(closed, head `f2df28ac`, branch `fm/planlet-archive-link-fix-scout`) built
the same feature as a 2,871-line hand scanner plus a 2,130-line entity table.
It went through 40 commits, nearly all fixing CommonMark edge cases found in
review. It is reference only. Implementation starts on a fresh branch off the
default branch. Its edge cases are the Test Matrix below.

**Probe** (a throwaway project outside the repository). It ran 18 fixtures
from those edge cases, plus all 652 CommonMark 0.31.2 spec examples (123
have a link destination). For the spec examples it checked every expected
`href`/`src` against the decoded destinations each parser reported.

| Parser                           | Destination source ranges | Fixtures | Spec link misses (real)                | Entity decoding | Bundled, unminified |
| -------------------------------- | ------------------------- | -------- | -------------------------------------- | --------------- | ------------------- |
| `mdast-util-from-markdown` 2.0.3 | Yes                       | 18/18    | 0                                      | Yes             | 185,140 bytes       |
| `@lezer/markdown` 1.7.2          | Yes                       | 18/18    | 2 (ex. 493 false link, ex. 512 missed) | No              | 129,337 bytes       |
| `markdown-it` 15.0.2             | No (block line maps only) | n/a      | not measured                           | Yes             | 198,068 bytes       |
| `marked` 18.0.14                 | No (`raw` text only)      | n/a      | not measured                           | No              | 58,815 bytes        |

The only other spec misses were empty destinations and raw HTML, and every
parser shared them. Neither has anything to rewrite. Reported offsets index
the original string, including CRLF and bare-CR files. A prototype rewrite
on the chosen parser passed all fixtures byte-exactly, and a second pass
changed nothing.

**Chosen:** `mdast-util-from-markdown` 2.0.3 with its documented extension
handlers, plus `micromark-util-decode-string` 2.0.1. These are the exact
versions the probe used. **Rejected:** `@lezer/markdown` (the two spec misses
fall in the closed attempt's problem area, and it has no entity decoding).
`markdown-it` and `marked` (no destination positions, so byte-exact edits
would mean scanning by hand again). A hand scanner (the closed attempt).
Re-serializing a syntax tree (reformats the whole file). micromark's raw
`parse`/`postprocess` exports give the same ranges but are not documented
API.

**Parser limits.** It parses CommonMark, not GFM. Links in table cells are
still found. A GFM footnote `[^1]: ../x.md` parses as a definition, so the
rewrite skips definitions whose label starts with `^`. The probe confirmed
the label is available when the destination is reported. A table-escaped
pipe (`a\|b.md`) keeps its backslash when decoded, so the target looks
missing and the link is left unchanged with a note.

## Dependency Decision

Add `mdast-util-from-markdown` `2.0.3` and `micromark-util-decode-string`
`2.0.1` as exact-pinned **devDependencies**, recorded as such in
`package.json` and `package-lock.json`. esbuild bundles every import into
`dist/planlet.mjs` (`scripts/build.mjs`), and `files` ships only `dist`. So
`dependencies` stays absent and users install nothing extra. This follows the
bundled `@toon-format/toon` precedent. `planlet_design.md` names the parser
as a second deliberate exception, adopted instead of a hand-written CommonMark
scanner. The unminified bundle grows from 134,202 bytes (base commit) by
about 185 KB, mostly the entity table CommonMark requires. The packaging test
(`tests/integration/packaging.test.ts`) installs the packed tarball and runs
it, which proves the bundle is self-contained.

## Scope

Changes:

- `src/core/plan/link-rewrite.ts` (new): a pure function that returns the
  rewritten text, a rewrite count, and warning notes.
- `src/core/plan/planlet-completion.ts`: call it in the fresh and resume
  completion paths and publish the results atomically.
- `package.json` and `package-lock.json`: the two devDependencies.
- `tests/unit/link-rewrite.test.ts` (new) and
  `tests/integration/completion.test.ts`.
- `planlet_design.md`: completion step 9 and the dependency exception.
- `README.md`: the complete step mentions the link rewrite.
- `skills/planlet-complete/SKILL.md`: on success, report the CLI's warnings
  (including link-rewrite notes) to the user. Regenerate the tracked installed
  copies and manifests with `node dist/planlet.mjs update`.
- `tests/skills/skill-contract.test.ts`: a structural assertion that the
  complete skill tells the agent to report completion warnings.
- `CHANGELOG.md` under `[Unreleased]`: user-visible CLI and skill behavior.

Excluded:

- Links from other repository files into the moved planlet.
- Already archived planlets under `plans/completed/`: no migration.
- Raw HTML `href`/`src`, autolinks, and files other than `plan.md` and
  `tasks.md`.
- `validate` and `check-completion`.

## Approach

Parse each file with `mdast-util-from-markdown`, collect destination token
ranges through its extension handlers, classify each decoded destination, and
splice `../` into the original text. No tree is serialized back.

### Rewrite Semantics

**Input.** The file text, `planDir` = `plans/<slug>`, `archiveDir` =
`plans/completed/<archiveName>` (both repository-relative, `/`-separated), and
`exists(repoRelativePath)`. Completion wires `exists` as
`tryLstat(join(repositoryRoot, path)) !== null`.

**Destinations considered.** Every `resourceDestination` token (inline links
and images, including an image inside a link) and every
`definitionDestination` token whose definition label does not start with `^`.
Reference uses carry no destination; their definition is rewritten once. Code
spans, code blocks, HTML, and non-links produce no destination tokens, so they
are never touched. An angle-bracket destination's range includes `<` and `>`.
Its inner text is classified, and `../` goes inside the brackets.

**Classification.** Decode the destination with `decodeString` (backslash
escapes and entity references). Then:

1. Not local relative: empty, starts with a URL scheme
   (`^[A-Za-z][A-Za-z0-9+.-]*:`), `/`, `#`, or `?`. Left unchanged, no note.
2. Take the path before the first `?` or `#` and percent-decode it. If
   `decodeURIComponent` throws, or the decoded path contains NUL (for
   example from `%00`), leave the link unchanged with an `invalid path` note.
   Never pass such a path to the filesystem.
3. Resolve lexically with `path.posix` against `planDir` (the active target)
   and against `archiveDir` (the archive target). A resolution that climbs
   above the repository root is no target. Backslashes are literal.
4. Active target inside `planDir`: the target moves with the planlet, so leave
   it unchanged. If the path names the planlet through its parent (for example
   `../<slug>/tasks.md`), add a note: the archive rename breaks it, and fixing
   it is out of scope.
5. Test existence of both targets. If `exists` throws for either target
   (Node rejects some platform-invalid names with errors other than
   not-found), catch it and leave the link unchanged with an `invalid path`
   note. One bad destination never aborts completion.
   - active only: rewrite by inserting `../` at the start of the raw path;
   - archive only: already written for the archive depth, leave unchanged,
     no note;
   - both: ambiguous, leave unchanged with a note;
   - neither: unresolved, leave unchanged with a note.

The rewrite never re-encodes. Only the three bytes `../` are inserted, at the
destination start (inside `<` when angled). Titles, whitespace, line endings,
query, fragment, and every other byte stay identical, whether the file uses
LF, CRLF, or bare CR line endings. Edits are applied once,
in source order, over the original offsets.

**Idempotence.** A rewritten destination resolves from the archive base to the
original target. On a second pass that is an archive-only or both case, so it
is never rewritten twice. The prototype confirmed this.

**Warnings.** These use the existing `summary.warnings` channel.
`Rewrote N relative link(s) in plan.md|tasks.md for the archived location`
appears when N > 0. `<file> link left unchanged (<reason>: <raw destination>)`
appears for each note. Reasons are `unresolved target`, `ambiguous target`,
`reaches planlet through its parent directory`, and `invalid path`.
Plans with no qualifying links produce no new warnings and byte-identical
files.

### Completion Integration

Fresh path (`completePlanletLocked`): after the collision checks, rewrite
`plan.md` and `tasks.md`. Append the completion record to the rewritten
`tasks.md`, so the audit record is written verbatim and never rewritten.
Validate both rewritten texts as `completed`. Publish `tasks.md` (the existing
audit publish and crash-recovery point) and then, only if it changed,
`plan.md` through a second `atomicPublish` with the same `write_conflict`
mapping and `auditRecorded: true`. Then move the planlet.

Resume path (`resumeRecordedCompletion`): `tasks.md` already holds the
rewritten text, because it was published in one write together with the
record. Rewrite and publish `plan.md` only. By idempotence this is a no-op
when the crash happened after the `plan.md` publish.

**Warnings describe the current invocation only.** Both paths add the notes
and rewrite counts produced by the rewrite passes they actually ran. On
resume that means `plan.md` only. The `tasks.md` rewrite count from the
interrupted run is not reported again, and a resumed `tasks.md` never
produces link warnings. Nothing is persisted to reconstruct them.

## Test Matrix

Unit tests (`tests/unit/link-rewrite.test.ts`) call the pure function with a
fake `exists`. Every row asserts the exact output text.

| Case                                                                                                                       | Expected                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Link in nested list, in block quote inside a list item                                                                     | rewritten                                             |
| Link in code span (single and multi-backtick), fenced block (tilde, backtick, in list item, in block quote), indented code | unchanged                                             |
| Lazy paragraph line indented four spaces                                                                                   | rewritten (paragraph text, not code)                  |
| Reference definition with full/collapsed/shortcut uses                                                                     | definition destination rewritten once                 |
| Definition with destination on next line and multi-line title                                                              | rewritten, title intact                               |
| Definition title containing `[b](../x.md)`                                                                                 | only destination rewritten                            |
| Lazy `[a]: ../x.md` line after paragraph text                                                                              | unchanged (not a definition)                          |
| GFM footnote definition `[^1]: ../x.md`                                                                                    | unchanged                                             |
| Escaped `\)` and `\#`, balanced `(p)` in destination                                                                       | rewritten, escapes preserved                          |
| `&amp;`, `&#35;`, unknown `&bogus;` in destination                                                                         | classified on decoded path, bytes preserved           |
| Angle-bracket destination with space and title with parentheses                                                            | `<../../…>`, title intact                             |
| Destination and title on separate lines inside `(…)`                                                                       | rewritten                                             |
| CRLF file with inline link and multi-line definition                                                                       | rewritten, every `\r\n` preserved                     |
| Bare-CR file with inline link and multi-line definition                                                                    | rewritten, every `\r` preserved, no `\n` added        |
| Image, image inside link                                                                                                   | both destinations rewritten                           |
| Nested brackets `[outer [inner](a)](b)`                                                                                    | only inner destination rewritten                      |
| HTML block and HTML comment containing link text                                                                           | unchanged                                             |
| Non-ASCII text before link                                                                                                 | correct offsets                                       |
| Link inside GFM table cell                                                                                                 | rewritten                                             |
| Sibling, subdirectory, `#anchor`, scheme URL, `/absolute`                                                                  | unchanged, no note                                    |
| `../other/plan.md`, `../../src/x.ts`, `../completed/<a>/plan.md#s`                                                         | rewritten, fragment kept                              |
| Pre-written archive-depth link                                                                                             | unchanged, no note                                    |
| Target missing at both depths; above repository root                                                                       | unchanged, `unresolved target` note                   |
| Target exists at both depths                                                                                               | unchanged, `ambiguous target` note                    |
| `../<slug>/tasks.md`                                                                                                       | unchanged, parent-directory note                      |
| Malformed percent-encoding `%zz`; `%00` (decodes to NUL)                                                                   | unchanged, `invalid path` note, `exists` never called |
| `exists` throws for a target                                                                                               | unchanged, `invalid path` note, no throw              |
| Second pass over any rewritten output                                                                                      | identical text                                        |

Integration tests (`tests/integration/completion.test.ts`) use real temporary
repositories:

- Completion archives a planlet whose `plan.md` and `tasks.md` link to a
  sibling planlet, a repository-root file, and an image. The links are
  rewritten, the warnings report the counts, and the archived files validate.
- A planlet with only internal links archives byte-identical except for the
  completion record, and produces no new warnings.
- A completion record whose reason contains a relative link keeps it verbatim.
- Resume after a simulated failure between the `tasks.md` and `plan.md`
  publishes (injected `replaceFile` throws on the second call): rerunning
  `complete` rewrites `plan.md`, leaves `tasks.md` unchanged, and archives.
  Its warnings report the `plan.md` rewrite count and no `tasks.md` count.
- Resume after both publishes (failed move): rerunning archives without
  rewriting anything again.

## Acceptance Criteria

- Every test matrix row passes against the micromark-based implementation,
  with no hand-written Markdown scanning in `src/`.
- `package.json` has no `dependencies` field. The two parser packages are
  exact-pinned devDependencies, and the packaging test passes.
- `planlet_design.md` names the parser as a deliberate bundled exception and
  describes the rewrite in completion step 9.
- The complete skill tells the agent to report completion warnings, and the
  tracked installed copies match (`planlet tools` reports `installed`).
- `CHANGELOG.md` `[Unreleased]` describes the new completion behavior.

## Verification

Repository suite in the documented order: `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`,
`npm test`, `git diff --check`, then `git status --porcelain` expecting no
unexpected paths.

Targeted: `npx tsx --test tests/unit/link-rewrite.test.ts` and
`npx tsx --test tests/integration/completion.test.ts`. `npm run knip` confirms
both new devDependencies are used. After `npm run build`, the packaging test
run inside `npm test` confirms the bundle is self-contained. Skill regeneration:
`npm run build`, `node dist/planlet.mjs update`, then
`node dist/planlet.mjs --root . tools` reports every destination `installed`,
and `npx tsx --test tests/skills/skill-contract.test.ts` passes.

## Risks and Considerations

- CommonMark versus GitHub rendering: the known gaps are footnotes (handled)
  and table-escaped pipes (left unchanged with a note). Other GFM extensions
  do not create link destinations.
- The existence probe is lexical plus `lstat`. A symlinked target counts as
  existing. On Windows, a literal backslash in a destination is probed as a
  separator. That is a rare, known limit also accepted by the closed attempt.
- An upgrade of the parser could change the token names
  (`resourceDestination`, `definitionDestination`). The exact pins and the
  unit matrix catch that.

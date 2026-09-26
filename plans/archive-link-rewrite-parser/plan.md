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
runtime `dependencies`. The choice rests on a throwaway probe, recorded below.

## Background: the closed attempt

Pull request https://github.com/vipentti/planlet/pull/99 (closed, not merged,
head `f2df28ac`, branch `fm/planlet-archive-link-fix-scout`) implemented the
same feature. It is reference only: implementation starts from a fresh branch
off the default branch, not from that branch.

It grew to a 2,871-line hand-written scanner (`link-rewrite.ts`) plus a
2,130-line HTML entity table, across 40 commits. Almost every commit after the
first fixed a CommonMark parsing edge case that review found. Grouped by the
commit history, the cases were:

- Code: inline code spans with runs of several backticks and unmatched runs;
  fenced blocks (tilde and backtick, closer length, info strings); indented
  code versus lazy paragraph continuation; fences inside block quotes and list
  items, and when a new list item or the end of a container closes them.
- Containers: nested lists and block quotes, list content columns with tabs,
  lazy continuation, blank-first list items, ordered-list interruption rules.
- Reference definitions: definition-first span ownership, destination on the
  next line, multi-line labels and titles, a title containing link syntax,
  lazy lines that must not become definitions, definitions inside containers.
- Destinations: escaped delimiters (`\)`, `\#`), balanced parentheses, angle
  brackets with spaces, titles with parentheses, one line ending inside the
  link, entity and numeric references (`&amp;`, `&#35;`), percent-encoding,
  and query/fragment splitting after decoding.
- Links: nested brackets (an inner link voids the outer one), images inside
  links, raw HTML blocks and comments (all seven CommonMark HTML block kinds).
- Bytes: CRLF and CR line endings, splicing only destination bytes so titles,
  whitespace, and the rest of the file stay byte-identical.

That list is the acceptance surface for this plan. A real CommonMark parser
already implements each of these rules; this plan's code only reads the
parser's destination ranges.

## Parser Evaluation

Candidates: `@lezer/markdown` 1.7.2 (named in the request),
`mdast-util-from-markdown` 2.0.3 on `micromark` 4.0.3, `markdown-it` 15.0.2,
and `marked` 18.0.14.

**Probe.** A scratch project outside the repository installed all four and ran
18 fixtures drawn from the closed attempt's failures: a link in a nested
list and block quote, links in code spans and fenced blocks (including a fence
in a list item), indented code versus lazy continuation, a fence in a block
quote, reference definitions and their uses (full, collapsed, shortcut), a
destination on the next line with a multi-line title, a definition inside a
list item with an angle-bracket destination, a definition title containing
link syntax, a lazy line that is not a definition, escaped delimiters, entity
and numeric references, a CRLF file, images including an image inside a link,
angle brackets with spaces and a title, nested brackets, HTML blocks and
comments, non-ASCII text before a link, and a GFM table cell. Each fixture
listed the exact source slices a rewrite must splice.

It also ran every example in the CommonMark 0.31.2 spec (652 examples, 123
with a link destination) through both range-reporting parsers. It compared the
two parsers' ranges and checked every `href`/`src` in the spec's expected HTML
against the decoded destinations each parser reported.

**Measured results.**

| Parser            | Exact destination ranges                     | 18 fixtures                                                       | CommonMark spec                                                                      | Decodes entities        | Bundled size (unminified)   |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------- | --------------------------- |
| micromark / mdast | Yes                                          | 18/18                                                             | No misses                                                                            | Yes (`decodeString`)    | 185,140 bytes               |
| `@lezer/markdown` | Yes (`URL` nodes)                            | 18/18                                                             | 2 wrong: ex. 493 reports a destination for non-link text; ex. 512 misses a real link | No; needs its own table | 129,337 bytes, plus a table |
| `markdown-it`     | No: inline tokens carry only block line maps | Destinations only, percent-encoded; definitions have no positions | Not measured                                                                         | Yes                     | 198,068 bytes               |
| `marked`          | No: tokens carry `raw` text only             | Destinations only                                                 | Not measured                                                                         | No (`&amp;` stays)      | 58,815 bytes                |

The four spec misses shared by both range-reporting parsers were all empty
destinations (`[link]()`, `[]()`, `[foo]()`) or raw HTML, neither of which has
anything to rewrite. Both range parsers reported offsets into the original
string: CRLF offsets pointed at the original bytes, and splicing `../` at
the reported starts left every other byte unchanged in all 18 fixtures.

An end-to-end prototype rewrite on micromark passed all fixtures, and a second
pass over its own output changed nothing.

**Limits found by the probe.**

- micromark parses CommonMark, not GFM. Links inside GFM table cells are still
  found (the row parses as paragraph text). One GFM construct differs: a
  footnote definition `[^1]: ../x.md` is a link reference definition in
  CommonMark. The rewrite skips definitions whose label starts with `^`; the
  probe confirmed the label is available when the destination is reported.
- A destination containing a table-escaped pipe (`a\|b.md` in a table cell)
  keeps its backslash in the decoded path under CommonMark. The target then
  looks missing and the link is left unchanged with a warning. That is safe,
  and rare in plan files.
- `micromark`'s own `parse`/`postprocess`/`preprocess` exports give the same
  ranges but are not in its documented API. The plan uses the documented
  `mdast-util-from-markdown` extension handlers instead. They cost about
  23 KB more bundled than the raw event API.

**Rejected alternatives.**

- `@lezer/markdown`: it is smaller, but it is wrong on two spec examples that
  sit exactly in the closed attempt's problem area (escaped angle-bracket
  destination, nested brackets). It also has no entity decoding, so it would
  bring back the entity table the closed attempt had to carry.
- `markdown-it`, `marked`: neither reports source positions for destinations,
  so rewriting exact bytes would mean scanning by hand again.
- Hand-written scanner (the closed attempt): measured cost of 40 review
  rounds and about 5,000 lines, with no sign of converging.
- Re-serializing the document from a syntax tree (for example
  `mdast-util-to-markdown`): it reformats the whole file. Only destination
  bytes may change.

## Dependency Decision

Add `mdast-util-from-markdown` and `micromark-util-decode-string` as exact
pinned **devDependencies**. esbuild already bundles every import into
`dist/planlet.mjs` (`scripts/build.mjs`), and `package.json` `files` ships
only `dist`, so users install nothing extra and `dependencies` stays absent.
This follows the existing `@toon-format/toon` precedent: a devDependency
bundled into the CLI, named as a deliberate exception in `planlet_design.md`.
Update that line to name the Markdown parser as a second exception, adopted
instead of a hand-written CommonMark scanner.

The cost is accepted: the unminified bundle grows from 134,202 bytes
(measured at the base commit) by roughly 185 KB, most of it the HTML named
character reference table that CommonMark requires. The packaging
integration test (`tests/integration/packaging.test.ts`) installs the packed
tarball and runs the bin. It keeps proving that nothing resolves at runtime
outside the bundle.

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
- `CHANGELOG.md` under `[Unreleased]`: user-visible CLI behavior.

Excluded:

- Links from other repository files into the moved planlet.
- Already archived planlets under `plans/completed/`: no migration.
- Raw HTML `href`/`src`, autolinks, and files other than `plan.md` and
  `tasks.md`.
- `validate`, `check-completion`, and skill text. The complete skill already
  relays CLI warnings.

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
   `decodeURIComponent` throws, leave the link unchanged with a note.
3. Resolve lexically with `path.posix` against `planDir` (the active target)
   and against `archiveDir` (the archive target). A resolution that climbs
   above the repository root is no target. Backslashes are literal.
4. Active target inside `planDir`: the target moves with the planlet, so leave
   it unchanged. If the path names the planlet through its parent (for example
   `../<slug>/tasks.md`), add a note: the archive rename breaks it, and fixing
   it is out of scope.
5. Test existence of both targets:
   - active only: rewrite by inserting `../` at the start of the raw path;
   - archive only: already written for the archive depth, leave unchanged,
     no note;
   - both: ambiguous, leave unchanged with a note;
   - neither: unresolved, leave unchanged with a note.

The rewrite never re-encodes. Only the three bytes `../` are inserted, at the
destination start (inside `<` when angled). Titles, whitespace, line endings,
query, fragment, and every other byte stay identical. Edits are applied once,
in source order, over the original offsets.

**Idempotence.** A rewritten destination resolves from the archive base to the
original target. On a second pass that is an archive-only or both case, so it
is never rewritten twice. The prototype confirmed this.

**Warnings.** These use the existing `summary.warnings` channel.
`Rewrote N relative link(s) in plan.md|tasks.md for the archived location`
appears when N > 0. `<file> link left unchanged (<reason>: <raw destination>)`
appears for each note. Reasons are `unresolved target`, `ambiguous target`,
`reaches planlet through its parent directory`, and `undecodable path`.
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
when the crash happened after the `plan.md` publish. Add the link warnings to
the result in both paths.

## Test Matrix

Unit tests (`tests/unit/link-rewrite.test.ts`) call the pure function with a
fake `exists`. Every row asserts the exact output text.

| Case                                                                                                                       | Expected                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Link in nested list, in block quote inside a list item                                                                     | rewritten                                   |
| Link in code span (single and multi-backtick), fenced block (tilde, backtick, in list item, in block quote), indented code | unchanged                                   |
| Lazy paragraph line indented four spaces                                                                                   | rewritten (paragraph text, not code)        |
| Reference definition with full/collapsed/shortcut uses                                                                     | definition destination rewritten once       |
| Definition with destination on next line and multi-line title                                                              | rewritten, title intact                     |
| Definition title containing `[b](../x.md)`                                                                                 | only destination rewritten                  |
| Lazy `[a]: ../x.md` line after paragraph text                                                                              | unchanged (not a definition)                |
| GFM footnote definition `[^1]: ../x.md`                                                                                    | unchanged                                   |
| Escaped `\)` and `\#`, balanced `(p)` in destination                                                                       | rewritten, escapes preserved                |
| `&amp;`, `&#35;`, unknown `&bogus;` in destination                                                                         | classified on decoded path, bytes preserved |
| Angle-bracket destination with space and title with parentheses                                                            | `<../../…>`, title intact                   |
| Destination and title on separate lines inside `(…)`                                                                       | rewritten                                   |
| CRLF file with inline link and multi-line definition                                                                       | rewritten, every `\r\n` preserved           |
| Image, image inside link                                                                                                   | both destinations rewritten                 |
| Nested brackets `[outer [inner](a)](b)`                                                                                    | only inner destination rewritten            |
| HTML block and HTML comment containing link text                                                                           | unchanged                                   |
| Non-ASCII text before link                                                                                                 | correct offsets                             |
| Link inside GFM table cell                                                                                                 | rewritten                                   |
| Sibling, subdirectory, `#anchor`, scheme URL, `/absolute`                                                                  | unchanged, no note                          |
| `../other/plan.md`, `../../src/x.ts`, `../completed/<a>/plan.md#s`                                                         | rewritten, fragment kept                    |
| Pre-written archive-depth link                                                                                             | unchanged, no note                          |
| Target missing at both depths; above repository root                                                                       | unchanged, `unresolved target` note         |
| Target exists at both depths                                                                                               | unchanged, `ambiguous target` note          |
| `../<slug>/tasks.md`                                                                                                       | unchanged, parent-directory note            |
| Malformed percent-encoding `%zz`                                                                                           | unchanged, `undecodable path` note          |
| Second pass over any rewritten output                                                                                      | identical text                              |

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
- Resume after both publishes (failed move): rerunning archives without
  rewriting anything again.

## Acceptance Criteria

- Every test matrix row passes against the micromark-based implementation,
  with no hand-written Markdown scanning in `src/`.
- `package.json` has no `dependencies` field. The two parser packages are
  exact-pinned devDependencies, and the packaging test passes.
- `planlet_design.md` names the parser as a deliberate bundled exception and
  describes the rewrite in completion step 9.
- `CHANGELOG.md` `[Unreleased]` describes the new completion behavior.

## Verification

Repository suite in the documented order: `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run type-check`, `npm run build`,
`npm test`, `git diff --check`, then `git status --porcelain` expecting no
unexpected paths.

Targeted: `npx tsx --test tests/unit/link-rewrite.test.ts` and
`npx tsx --test tests/integration/completion.test.ts`. `npm run knip` confirms
both new devDependencies are used. After `npm run build`, the packaging test
run inside `npm test` confirms the bundle is self-contained.

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

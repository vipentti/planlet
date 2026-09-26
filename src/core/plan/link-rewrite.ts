/**
 * Rewrites relative Markdown link destinations that escape a planlet
 * directory when `complete` moves it one level deeper into
 * `plans/completed/<date>-<slug>/`.
 *
 * The rewrite is a pure prefix edit: links that resolve inside `plans/` but
 * outside the plan directory need exactly one extra `../` level from the
 * archived depth. Links that stay inside the plan (siblings, subdirectories,
 * pure `#anchor` links), absolute paths, external URLs, pre-written
 * archived-depth links, and dangling links are left byte-identical.
 */

export interface LinkRewriteOutcome {
  readonly text: string;
  /** Number of link destinations rewritten. */
  readonly rewritten: number;
  /** Human-readable skip notes (file context is added by the caller). */
  readonly skipped: readonly string[];
}

export interface LinkTargetExistence {
  /** True when the decoded link target exists (absolute path probe). */
  readonly exists: (absolutePath: string) => boolean;
}

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const PROTOCOL_RELATIVE_PATTERN = /^\/\//;
const ABSOLUTE_PATH_PATTERN = /^\//;
const FRAGMENT_ONLY_PATTERN = /^#/;

function isExternalDestination(destination: string): boolean {
  return (
    destination.length === 0 ||
    FRAGMENT_ONLY_PATTERN.test(destination) ||
    ABSOLUTE_PATH_PATTERN.test(destination) ||
    PROTOCOL_RELATIVE_PATTERN.test(destination) ||
    SCHEME_PATTERN.test(destination)
  );
}

/**
 * Splits a destination into its path part and the trailing
 * `?query`/`#fragment`/whitespace-plus-title suffix, which passes through
 * byte-identical. Returns null when the destination has no path part.
 * Angle-bracket destinations (`<path with spaces>`) parse as one path.
 */
function splitDestination(
  destination: string,
): { path: string; suffix: string; angled: boolean } | null {
  const trimmed = destination.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("<")) {
    const close = trimmed.indexOf(">");
    if (close === -1) return null;
    const path = trimmed.slice(1, close);
    if (path.length === 0) return null;
    return { path, suffix: trimmed.slice(close + 1), angled: true };
  }
  let end = trimmed.length;
  const hashIndex = trimmed.indexOf("#");
  const queryIndex = trimmed.indexOf("?");
  if (hashIndex !== -1) end = Math.min(end, hashIndex);
  if (queryIndex !== -1) end = Math.min(end, queryIndex);
  // A title suffix starts at whitespace.
  const spaceIndex = trimmed.slice(0, end).search(/\s/);
  if (spaceIndex !== -1) end = spaceIndex;
  const path = (
    end === trimmed.length ? trimmed : trimmed.slice(0, end)
  ).trim();
  if (path.length === 0) return null;
  return { path, suffix: trimmed.slice(end), angled: false };
}

/**
 * POSIX-only lexical resolution of a `/`-separated link path against a
 * `/`-separated base directory. Backslashes are literal characters in
 * Markdown links, never separators. Returns null when the path escapes
 * above the repository root.
 */
export function resolveLinkPath(base: string, linkPath: string): string | null {
  const baseParts =
    base.length === 0 ? [] : base.split("/").filter((part) => part !== "");
  const parts: string[] = [...baseParts];
  for (const part of linkPath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function planPrefix(planDir: string): string {
  return planDir.length === 0 ? "" : `${planDir}/`;
}

function escapesPlan(planDir: string, resolved: string | null): boolean {
  if (resolved === null) return true;
  return resolved !== planDir && !resolved.startsWith(planPrefix(planDir));
}

function rewritePath(encodedPath: string): string {
  return `../${encodedPath}`;
}

/**
 * Classifies a bare destination path (no brackets, no title).
 * Returns the rewritten path, or null when it must pass through.
 * `skipped` carries the skip note when one applies.
 */
function classifyDestinationPath(
  encodedPath: string,
  planDir: string,
  repositoryRoot: string,
  existence: LinkTargetExistence,
): { rewritten: string | null; skipped?: string } {
  if (isExternalDestination(encodedPath)) {
    return { rewritten: null };
  }
  // Split the query/fragment suffix before decoding: `%23` in the path
  // is data, while a literal `#` starts the fragment.
  let pathEnd = encodedPath.length;
  const hashIndex = encodedPath.indexOf("#");
  const queryIndex = encodedPath.indexOf("?");
  if (hashIndex !== -1) pathEnd = Math.min(pathEnd, hashIndex);
  if (queryIndex !== -1) pathEnd = Math.min(pathEnd, queryIndex);
  const pathOnly = encodedPath.slice(0, pathEnd);
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    decoded = pathOnly;
  }
  const oldResolved = resolveLinkPath(planDir, decoded);
  // Links escaping above the repository root are never guessed at.
  if (oldResolved === null) {
    return {
      rewritten: null,
      skipped: `outside repository: ${encodedPath}`,
    };
  }
  if (!escapesPlan(planDir, oldResolved)) {
    return { rewritten: null };
  }
  // A pre-written archived-depth link (correct only after the move) must
  // not be rewritten again. From the active base it climbs above `plans/`
  // into a repository-root-relative target; rewriting would push it one
  // level too far. Detect it lexically: a link that resolves from the old
  // base to a path outside `plans/` entirely was authored for the archived
  // depth (or dangles), so only rewrite links that resolve inside `plans/`.
  if (!oldResolved.startsWith("plans/")) {
    return { rewritten: null };
  }
  // Dangling links (no such target on disk) are never guessed at:
  // rewriting them would corrupt text no reader could have followed.
  if (!existence.exists(`${repositoryRoot}/${oldResolved}`)) {
    return {
      rewritten: null,
      skipped: `missing target: ${encodedPath}`,
    };
  }
  return { rewritten: rewritePath(encodedPath) };
}

function rewriteDestination(
  destination: string,
  planDir: string,
  repositoryRoot: string,
  existence: LinkTargetExistence,
): {
  destination: string;
  rewritten: boolean;
  skipped?: string;
} {
  const split = splitDestination(destination);
  if (split === null) {
    return { destination, rewritten: false };
  }
  const classified = classifyDestinationPath(
    split.path,
    planDir,
    repositoryRoot,
    existence,
  );
  if (classified.rewritten === null) {
    return {
      destination,
      rewritten: false,
      ...(classified.skipped === undefined
        ? {}
        : { skipped: classified.skipped }),
    };
  }
  const newPath = split.angled
    ? `<${classified.rewritten}>`
    : classified.rewritten;
  const rewritten = `${newPath}${split.suffix}`;
  return { destination: rewritten, rewritten: true };
}

/**
 * Splits Markdown text into protected spans (fenced code blocks, indented
 * code blocks, inline code spans, HTML comments) and rewritable spans.
 * Only rewritable spans are link-rewritten.
 */
interface ProtectedSpan {
  readonly protected_: boolean;
  readonly text: string;
  /** Byte offset of the span start within the source document. */
  readonly offset: number;
  /** Block kind for protected spans: fence, indented, code, or html. */
  readonly kind: "fence" | "indented" | "code" | "html" | "text";
}

/**
 * Excludes byte ranges (document-level link spans) from protection:
 * any protected interval intersecting an exclusion is dropped, because
 * the link owns those bytes (a label may hold inline code or HTML).
 * Links partly inside fenced/indented blocks never reach this stage:
 * block splitting runs first and document recognition only feeds ranges
 * for hole-punching at the inline level.
 */
function excludeRanges(
  intervals: Array<[number, number, ProtectedSpan["kind"]]>,
  exclusions: readonly { start: number; end: number }[],
): Array<[number, number, ProtectedSpan["kind"]]> {
  return intervals.filter(
    ([start, end]) =>
      !exclusions.some(
        (exclusion) => exclusion.start < end && exclusion.end > start,
      ),
  );
}

/**
 * Shared block-boundary rule: ATX headings, thematic breaks, and blank
 * lines end a paragraph. Used by both the block splitter (indented-code
 * starts) and reference-definition tracking (lazy continuation), so the
 * two models cannot disagree.
 */
function endsParagraph(line: string): boolean {
  return (
    line.trim().length === 0 ||
    /^(?: {0,3}> ?)? {0,3}#{1,6}(?:\s|$)/.test(line) ||
    /^(?: {0,3}> ?)? {0,3}(?:\*[ \t]*){3,}$/.test(line) ||
    /^(?: {0,3}> ?)? {0,3}(?:-[ \t]*){3,}$/.test(line) ||
    /^(?: {0,3}> ?)? {0,3}(?:_[ \t]*){3,}$/.test(line)
  );
}

function splitProtectedSpans(
  text: string,
  exclude: readonly { start: number; end: number }[] = [],
): readonly ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  const lines = text.split("\n");
  let current = "";
  let inFence = false;
  let fenceMarker = "";
  let fenceQuoted = false;
  let paragraphOpen = false;
  let previousWasCode = true;
  const canStartIndentedCode = (): boolean => !paragraphOpen || previousWasCode;
  const flush = (
    protected_: boolean,
    chunk: string,
    kind: ProtectedSpan["kind"] = protected_ ? "fence" : "text",
  ): void => {
    if (chunk.length === 0) return;
    const last = spans[spans.length - 1];
    if (
      last !== undefined &&
      last.protected_ === protected_ &&
      last.kind === kind
    ) {
      spans[spans.length - 1] = {
        protected_: last.protected_,
        text: last.text + chunk,
        offset: last.offset,
        kind: last.kind,
      };
    } else {
      spans.push({ protected_, text: chunk, offset: -1, kind });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const withNewline = index < lines.length - 1 ? `${line}\n` : line;
    // Fence state retains its container context: a fence opened inside a
    // block quote only closes on a quoted closer, and a top-level fence
    // only closes on a top-level closer, so a literal `> ``` line inside
    // top-level code can never terminate the block. A quoted fence ends
    // when its quote container ends: an unquoted line terminates it and
    // is reprocessed below. Deeper container nesting (lists inside quotes
    // and beyond) stays out of scope and is documented on
    // rewriteOutgoingLinks.
    const quoteMatch = /^ {0,3}> ?/.exec(line);
    const quoted = quoteMatch !== null;
    const stripped =
      quoteMatch === null ? line : line.slice(quoteMatch[0].length);
    // Fence openers allow at most three leading spaces; deeper indentation
    // is an indented code block, never a fence. Closing runs need the same
    // character, at least the opening length, and only spaces/tabs after.
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(stripped);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1] ?? "";
      const markerChar = marker[0] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceQuoted = quoted;
        flush(false, current);
        current = withNewline;
      } else if (
        quoted === fenceQuoted &&
        markerChar === (fenceMarker[0] ?? "") &&
        marker.length >= fenceMarker.length &&
        /^[ \t]*$/.test(
          stripped.slice(stripped.indexOf(marker) + marker.length),
        )
      ) {
        current += withNewline;
        flush(true, current, "fence");
        current = "";
        inFence = false;
        fenceMarker = "";
        fenceQuoted = false;
      } else {
        current += withNewline;
      }
      continue;
    }
    if (inFence) {
      if (fenceQuoted && !quoted) {
        // The quote container ended: close the quoted fence and
        // reprocess this line as ordinary Markdown.
        flush(true, current, "fence");
        current = "";
        inFence = false;
        fenceMarker = "";
        fenceQuoted = false;
      } else {
        current += withNewline;
        continue;
      }
    }
    // Indented code starts only where CommonMark permits a block start:
    // at the document start, after a blank line, or after another code
    // block. A four-space line continuing a paragraph is lazy
    // continuation text, never code, so links there stay rewritable.
    if (/^(?: {4}|\t)/.test(line) && !canStartIndentedCode()) {
      paragraphOpen = true;
      current += withNewline;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      flush(false, current);
      current = "";
      flush(true, withNewline, "indented");
      paragraphOpen = false;
      previousWasCode = true;
      continue;
    }
    if (endsParagraph(line)) {
      paragraphOpen = false;
      previousWasCode = false;
    } else if (fenceMatch === null) {
      paragraphOpen = true;
      previousWasCode = false;
    } else {
      paragraphOpen = false;
      previousWasCode = false;
    }
    current += withNewline;
  }
  flush(inFence, current);
  // Resolve block-span offsets in document order, preserving kinds.
  let blockBase = 0;
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
    const span = spans[spanIndex];
    if (span !== undefined) {
      spans[spanIndex] = {
        protected_: span.protected_,
        text: span.text,
        offset: blockBase,
        kind: span.kind,
      };
      blockBase += span.text.length;
    }
  }
  // Split inline code spans and HTML comments out of rewritable spans.
  // Raw HTML owns its bytes first: comment (and other tag) ranges are
  // excluded before backtick pairing, so a backtick inside HTML can never
  // pair with a visible backtick outside it. Backtick runs then scan as
  // whole delimiters per CommonMark: a span closes only on a run of
  // exactly the opener length, and spans may cross line breaks. Runs with
  // no exact-length closer are literal text.
  const result: ProtectedSpan[] = [];
  let inlineBase = 0;
  const emitSpan = (
    protected_: boolean,
    chunk: string,
    kind: ProtectedSpan["kind"] = protected_ ? "code" : "text",
  ): void => {
    if (chunk.length === 0) return;
    const last = result[result.length - 1];
    if (
      last !== undefined &&
      last.protected_ === protected_ &&
      last.kind === kind
    ) {
      result[result.length - 1] = {
        protected_: last.protected_,
        text: last.text + chunk,
        offset: last.offset,
        kind: last.kind,
      };
    } else {
      result.push({ protected_, text: chunk, offset: inlineBase, kind });
    }
    inlineBase += chunk.length;
  };
  for (const span of spans) {
    if (span.protected_) {
      emitSpan(true, span.text, span.kind);
      continue;
    }
    // Translate document-level link ranges into span coordinates: any
    // inline-code or HTML interval touching a link is dropped, so the
    // link stays whole. Links fully inside fenced blocks are excluded
    // from `exclude` by the caller (block protection wins there).
    const localExclusions = exclude
      .map((range) => ({
        start: range.start - span.offset,
        end: range.end - span.offset,
      }))
      .filter((range) => range.end > 0 && range.start < span.text.length);
    // Raw HTML ranges: comments plus inline tags on one line. Tag
    // detection is deliberately narrow (a `<` run to the next `>` with no
    // newline); anything exotic stays rewritable, which fails safe toward
    // rewriting a real link rather than hiding one.
    const htmlRanges: Array<[number, number]> = [
      ...span.text.matchAll(/<!--[\s\S]*?-->/g),
      ...span.text.matchAll(/<\/?[A-Za-z][^<>\n]*?>/g),
    ].map((tag) => [tag.index ?? 0, (tag.index ?? 0) + tag[0].length]);
    htmlRanges.sort((left, right) => left[0] - right[0]);
    const inHtml = (position: number): boolean =>
      htmlRanges.some(([start, end]) => position >= start && position < end);
    const runs = [...span.text.matchAll(/`+/g)].filter(
      (run) => !inHtml(run.index ?? 0),
    );
    const protectedRanges: Array<[number, number, ProtectedSpan["kind"]]> =
      htmlRanges.map(
        ([start, end]) =>
          [start, end, "html"] as [number, number, ProtectedSpan["kind"]],
      );
    let openStart = -1;
    let openLength = 0;
    for (const run of runs) {
      const start = run.index ?? 0;
      const length = run[0].length;
      if (openStart === -1) {
        openStart = start;
        openLength = length;
        continue;
      }
      if (length === openLength) {
        protectedRanges.push([openStart, start + length, "code"]);
        openStart = -1;
        openLength = 0;
      }
      // A longer or shorter run does not close the span: it becomes part
      // of the span body and scanning continues for an exact-length close.
    }
    // An unmatched opener protects nothing; its run stays rewritable.
    // Coalesce overlapping ranges (a comment nested inside a code span is
    // owned by the span) so slicing never duplicates or drops bytes.
    // Document-level link ranges punch holes: a link label may hold
    // inline code or HTML, and protection must not split the link.
    const punched = excludeRanges(protectedRanges, localExclusions);
    punched.sort((left, right) => left[0] - right[0]);
    const coalescedWithKind: Array<[number, number, ProtectedSpan["kind"]]> =
      [];
    for (const [start, end, kind] of punched) {
      const last = coalescedWithKind[coalescedWithKind.length - 1];
      if (
        last !== undefined &&
        start <= last[1] &&
        (last[2] === kind || last[2] === "code" || kind === "code")
      ) {
        last[1] = Math.max(last[1], end);
        last[2] = "code";
      } else if (last !== undefined && start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        coalescedWithKind.push([start, end, kind]);
      }
    }
    // Track whether each protected interval is HTML so kinds survive.
    let cursor = 0;
    for (const [start, end, kind] of coalescedWithKind) {
      if (start > cursor) {
        emitSpan(false, span.text.slice(cursor, start));
      }
      emitSpan(true, span.text.slice(start, end), kind);
      cursor = Math.max(cursor, end);
    }
    if (cursor < span.text.length) {
      emitSpan(false, span.text.slice(cursor));
    }
  }
  return result;
}

const REFERENCE_DEFINITION_PATTERN =
  /^(?:([ \t]{0,3}> ?)?)(\[[^\]\n\\]*(?:\\.[^\]\n\\]*)*\]:[ \t]*)(<[^>\n]+>|[^\s]+)(?:(?=[ \t]*$)|(?=[ \t]+(?:"[^"\n\\]*(?:\\.[^"\n\\]*)*"|'[^'\n\\]*(?:\\.[^'\n\\]*)*'|\([^)\n\\]*(?:\\.[^)\n\\]*)*\))[ \t]*$))/gm;

/** Matches a reference definition whose destination sits on the next line. */
const MULTILINE_DEFINITION_PATTERN =
  /^(?:([ \t]{0,3}> ?)?)(\[[^\]\n\\]*(?:\\.[^\]\n\\]*)*\]:[ \t]*\n[ \t]+)(<[^>\n]+>|[^\s]+)(?:(?=[ \t]*$)|(?=[ \t]+(?:"[^"\n\\]*(?:\\.[^"\n\\]*)*"|'[^'\n\\]*(?:\\.[^'\n\\]*)*'|\([^)\n\\]*(?:\\.[^)\n\\]*)*\))[ \t]*$))/gm;

interface InlineLinkMatch {
  readonly start: number;
  readonly end: number;
  readonly bang: string;
  readonly label: string;
  /** Byte range of the destination path only (no brackets, no title). */
  readonly destinationStart: number;
  readonly destinationEnd: number;
  /** Decoded destination path without brackets or title. */
  readonly destination: string;
  readonly angled: boolean;
}

/**
 * True when the character at `position` is backslash-escaped: preceded by
 * an odd run of consecutive backslashes.
 */
function isEscaped(text: string, position: number): boolean {
  let backslashes = 0;
  let cursor = position - 1;
  while (cursor >= 0 && text[cursor] === "\\") {
    backslashes += 1;
    cursor -= 1;
  }
  return backslashes % 2 === 1;
}

/** Counts `\n` characters in `text[start, end)`. */
function countLineEndings(text: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index += 1) {
    if (text[index] === "\n") count += 1;
  }
  return count;
}

/**
 * Skips spaces, tabs, and at most one line ending. Returns the remainder
 * plus the skipped prefix length, or null when more whitespace appears.
 */
function allowOneLineEnding(
  text: string,
): { text: string; prefix: number } | null {
  const match = /^[ \t]*(?:\n[ \t]*)?/.exec(text);
  if (match === null) return null;
  const prefix = match[0];
  const rest = text.slice(prefix.length);
  if (prefix.includes("\n")) {
    if (rest.startsWith("\n")) return null;
  } else if (rest.length === 0) {
    return { text: rest, prefix: prefix.length };
  }
  if (/^[ \t]*\n/.test(rest)) return null;
  return { text: rest, prefix: prefix.length };
}

/**
 * Matches an optional title plus the link-closing paren at the start of
 * `text`: `"..."`, `'...'`, or `(...)` with backslash-escaped delimiters
 * honored, spanning at most one line ending, then optional whitespace
 * and `)`. Returns the full match (title plus paren) or null. A bare
 * suffix never matches, so non-title text is rejected. Only `[0]` of the
 * returned array is read by callers.
 */
function parseTitleTail(text: string): RegExpExecArray | null {
  let cursor = 0;
  let lineBreaks = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === " " || char === "\t") {
      cursor += 1;
      continue;
    }
    if (char === "\n") {
      lineBreaks += 1;
      if (lineBreaks > 1) return null;
      cursor += 1;
      continue;
    }
    break;
  }
  if (cursor < text.length) {
    const char = text[cursor];
    if (char === '"' || char === "'" || char === "(") {
      const closer = char === "(" ? ")" : char;
      cursor += 1;
      let breaks = 0;
      let closed = false;
      while (cursor < text.length) {
        const inner = text[cursor];
        if (inner === "\\") {
          cursor += 2;
          continue;
        }
        if (inner === "\n") {
          breaks += 1;
          if (breaks > 1) return null;
          cursor += 1;
          continue;
        }
        if (inner === closer) {
          closed = true;
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      if (!closed) return null;
    }
  }
  let trailingBreaks = lineBreaks;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === " " || char === "\t") {
      cursor += 1;
      continue;
    }
    if (char === "\n") {
      trailingBreaks += 1;
      if (trailingBreaks > 1) return null;
      cursor += 1;
      continue;
    }
    break;
  }
  if (text[cursor] !== ")") return null;
  const matched = text.slice(0, cursor + 1);
  return [matched] as unknown as RegExpExecArray;
}

/**
 * Finds the first backtick run of exactly `length` in `text`, where the
 * run is neither preceded nor followed by another backtick. Returns the
 * run start or -1.
 */
function findExactRun(text: string, length: number): number {
  const ticks = "`".repeat(length);
  const pattern = new RegExp(`(?<!${ticks})${ticks}(?!${ticks[0] ?? "`"})`);
  const match = pattern.exec(text);
  return match === null ? -1 : (match.index ?? -1);
}

/**
 * Finds inline links `[label](destination)` and `![alt](destination)` with
 * a small scanner: backslash-escape parity is honored, labels balance
 * nested brackets, and destinations may hold balanced parentheses or one
 * `<...>` group with an optional title. One line ending is allowed between
 * the label close, the destination, and the title (CommonMark permits a
 * single line ending there). Returns byte offsets so the caller preserves
 * every untouched byte.
 */
function findInlineLinks(text: string): InlineLinkMatch[] {
  const matches: InlineLinkMatch[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("[", index);
    if (open === -1) break;
    if (isEscaped(text, open)) {
      index = open + 1;
      continue;
    }
    const bang =
      open > 0 && text[open - 1] === "!" && !isEscaped(text, open - 1)
        ? "!"
        : "";
    // Find the closing bracket, balancing nested brackets while
    // skipping inline code spans and raw HTML inside the label: backtick
    // runs pair by exact length and tags span to `>`, so `]` bytes
    // inside them never close the label. One line ending is allowed.
    let cursor = open + 1;
    let depth = 0;
    let closeBracket = -1;
    let lineBreaks = 0;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "`") {
        // Whole-run pairing: a closer must be a run of exactly the
        // opener length, never a prefix of a longer run. Scan runs
        // forward so `[a `` b ``` c]` keeps its backticks literal.
        const run = /`+/.exec(text.slice(cursor))?.[0] ?? "`";
        const rest = text.slice(cursor + run.length);
        const closer = findExactRun(rest, run.length);
        if (closer === -1) break;
        cursor = cursor + run.length + closer + run.length;
        continue;
      }
      if (char === "<" && !isEscaped(text, cursor)) {
        if (text.startsWith("<!--", cursor)) {
          const commentClose = text.indexOf("-->", cursor + 4);
          if (commentClose === -1) break;
          cursor = commentClose + 3;
          continue;
        }
        if (/^<\/?[A-Za-z]/.test(text.slice(cursor, cursor + 3))) {
          const tagClose = text.indexOf(">", cursor + 1);
          const newline = text.indexOf("\n", cursor + 1);
          if (tagClose !== -1 && (newline === -1 || tagClose < newline)) {
            cursor = tagClose + 1;
            continue;
          }
        }
      }
      if (char === "\n") {
        lineBreaks += 1;
        if (lineBreaks > 1) break;
        cursor += 1;
        continue;
      }
      if (char === "\\") {
        cursor += 2;
        continue;
      }
      if (char === "[") depth += 1;
      if (char === "]") {
        if (depth === 0) {
          closeBracket = cursor;
          break;
        }
        depth -= 1;
      }
      cursor += 1;
    }
    // The opening paren must immediately follow the label close:
    // CommonMark forbids whitespace between `]` and `(`. Whitespace is
    // allowed inside the parentheses instead (parsed below).
    if (
      closeBracket === -1 ||
      closeBracket + 1 >= text.length ||
      text[closeBracket + 1] !== "("
    ) {
      index = open + 1;
      continue;
    }
    // Parse the destination: `<...>` group (with optional title) or
    // balanced parentheses. Spaces, tabs, and one line ending may follow
    // the opening paren and surround the title.
    const inner = allowOneLineEnding(text.slice(closeBracket + 2));
    if (inner === null) {
      index = open + 1;
      continue;
    }
    const parenOffset = closeBracket + 1;
    const destStart = parenOffset + 1 + inner.prefix;
    let destEnd = -1;
    let end = -1;
    let angled = false;
    if (text[destStart] === "<") {
      const close = text.indexOf(">", destStart + 1);
      if (close !== -1 && countLineEndings(text, destStart, close) <= 1) {
        const after = allowOneLineEnding(text.slice(close + 1));
        const tail = after === null ? null : parseTitleTail(after.text);
        if (tail !== undefined && tail !== null && after !== null) {
          destEnd = close;
          end = close + 1 + after.prefix + tail[0].length;
          angled = true;
          matches.push({
            start: bang.length === 0 ? open : open - 1,
            end,
            bang,
            label: text.slice(open + 1, closeBracket),
            // Inside `<...>`: brackets stay outside, path only.
            destinationStart: destStart + 1,
            destinationEnd: close,
            destination: text.slice(destStart + 1, close),
            angled,
          });
          index = end;
          continue;
        }
      }
    } else {
      // Bare destination: the path runs to whitespace or a line ending
      // (optional title follows) or to the closing paren. Parentheses
      // inside quoted titles must not affect balance, so the scan is
      // title-aware: once whitespace ends the path, only the title
      // grammar to the final `)` matters. One line ending may separate
      // the destination from the title.
      let depth = 0;
      let pathEnd = -1;
      cursor = destStart;
      while (cursor < text.length) {
        const char = text[cursor];
        if (char === "\\") {
          cursor += 2;
          continue;
        }
        if (
          pathEnd === -1 &&
          (char === " " || char === "\t" || char === "\n")
        ) {
          pathEnd = cursor;
          break;
        }
        if (char === "(") depth += 1;
        if (char === ")") {
          if (depth === 0) {
            destEnd = cursor;
            end = cursor + 1;
            break;
          }
          depth -= 1;
        }
        cursor += 1;
      }
      if (pathEnd !== -1 && destEnd === -1) {
        // A title follows: accept `"..."`, `'...'`, or `(...)` then the
        // link close, allowing one line ending between components. A bare
        // non-whitespace suffix is not a title and never matches.
        const after = allowOneLineEnding(text.slice(pathEnd));
        const titleClose = after === null ? null : parseTitleTail(after.text);
        if (titleClose !== undefined && titleClose !== null) {
          destEnd = pathEnd;
          end =
            pathEnd +
            (after === null ? 0 : after.prefix) +
            titleClose[0].length;
        }
      }
    }
    if (destEnd === -1 || end === -1) {
      index = open + 1;
      continue;
    }
    matches.push({
      start: bang.length === 0 ? open : open - 1,
      end,
      bang,
      label: text.slice(open + 1, closeBracket),
      // Path bytes only: `<...>` brackets stay outside the range so the
      // splice prefixes the path and preserves the wrapper.
      destinationStart: destStart + (angled ? 1 : 0),
      destinationEnd: destEnd - (angled ? 1 : 0),
      destination: angled
        ? text.slice(destStart + 1, destEnd - 1)
        : text.slice(destStart, destEnd),
      angled,
    });
    index = end;
  }
  return matches;
}

/**
 * Rewrites pre-recognized document-level links that lie fully inside one
 * rewritable span. Only the destination-path bytes are spliced: every
 * other byte (whitespace, titles, brackets) passes through untouched, so
 * the transform stays a pure prefix edit.
 */
function rewriteOwnedLinks(
  text: string,
  spanOffset: number,
  owned: readonly InlineLinkMatch[],
  planDir: string,
  repositoryRoot: string,
  existence: LinkTargetExistence,
  skipped: string[],
): { text: string; rewritten: number } {
  let rewritten = 0;
  let cursor = 0;
  const parts: string[] = [];
  for (const found of owned) {
    const rawPath = text.slice(
      found.destinationStart - spanOffset,
      found.destinationEnd - spanOffset,
    );
    // Angle brackets never belong to the path: strip one wrapper pair
    // when the recognizer included it.
    const encodedPath =
      found.angled && rawPath.startsWith("<") && rawPath.endsWith(">")
        ? rawPath.slice(1, -1)
        : rawPath;
    const classified = classifyDestinationPath(
      encodedPath,
      planDir,
      repositoryRoot,
      existence,
    );
    if (classified.skipped !== undefined) skipped.push(classified.skipped);
    const start = found.start - spanOffset;
    const end = found.end - spanOffset;
    const pathStart = found.destinationStart - spanOffset;
    const pathEnd = found.destinationEnd - spanOffset;
    parts.push(text.slice(cursor, start));
    if (classified.rewritten === null) {
      parts.push(text.slice(start, end));
    } else {
      // Splice only the path bytes; brackets, wrapper, whitespace,
      // and titles stay exactly as authored.
      parts.push(text.slice(start, pathStart));
      parts.push(classified.rewritten);
      parts.push(text.slice(pathEnd, end));
      rewritten += 1;
    }
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return { text: parts.join(""), rewritten };
}

function rewriteReferenceDefinitions(
  text: string,
  planDir: string,
  repositoryRoot: string,
  existence: LinkTargetExistence,
  skipped: string[],
  paragraphOpen = false,
): { text: string; rewritten: number; paragraphOpen: boolean } {
  let rewritten = 0;
  const rewriteOne = (whole: string, destination: string): string => {
    const outcome = rewriteDestination(
      destination,
      planDir,
      repositoryRoot,
      existence,
    );
    if (outcome.skipped !== undefined) skipped.push(outcome.skipped);
    if (!outcome.rewritten) return whole;
    rewritten += 1;
    // The patterns consume no trailing title bytes (lookahead only), so
    // swap just the destination bytes and keep titles byte-identical.
    return whole.replace(destination, outcome.destination);
  };
  // Reference definitions are block-level: a definition line that
  // continues an open paragraph is lazy continuation text, not a
  // definition, and stays byte-identical.
  const lines = text.split("\n");
  const out: string[] = [];
  let open = paragraphOpen;
  const replaceLine = (
    line: string,
    pattern: RegExp,
  ): { line: string; matched: boolean } => {
    pattern.lastIndex = 0;
    const probe = pattern.exec(line);
    pattern.lastIndex = 0;
    if (probe === null) return { line, matched: false };
    // Paragraph gate before any rewrite side effect: a definition line
    // continuing a paragraph is lazy continuation text. The count must
    // not move when the bytes do not.
    if (open) return { line, matched: true };
    let matched = false;
    const replaced = line.replace(
      pattern,
      (
        whole: string,
        _container: string,
        _prefix: string,
        destination: string,
      ) => {
        matched = true;
        return rewriteOne(whole, destination);
      },
    );
    pattern.lastIndex = 0;
    return { line: replaced, matched };
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    // A definition destination may sit on the next line: join the pair
    // for matching, then split the rewrite back across both lines.
    const next = lineIndex + 1 < lines.length ? lines[lineIndex + 1] : null;
    const joined =
      next !== null && next !== undefined && /^[ \t]+\S/.test(next)
        ? `${line}\n${next}`
        : null;
    if (joined !== null) {
      const probe = replaceLine(joined, MULTILINE_DEFINITION_PATTERN);
      if (probe.matched) {
        if (open) {
          out.push(line);
          // Reprocess the next line on its own below.
        } else {
          const parts = probe.line.split("\n");
          out.push(parts[0] ?? line);
          out.push(parts[1] ?? next ?? "");
          lineIndex += 1;
          open = false;
        }
        if (open) {
          if (line.trim().length === 0) open = false;
          else if (!/^(?: {4}|\t)/.test(line)) open = true;
          continue;
        }
        continue;
      }
    }
    const single = replaceLine(line, REFERENCE_DEFINITION_PATTERN);
    if (!single.matched) {
      out.push(line);
      // Shared endsParagraph model: headings, breaks, and blanks end
      // the paragraph just like in the block splitter.
      if (/^(?: {4}|\t)/.test(line)) open = false;
      else if (endsParagraph(line)) open = false;
      else open = true;
      continue;
    }
    if (open) {
      out.push(line);
      continue;
    }
    out.push(single.line);
    open = false;
  }
  return { text: out.join("\n"), rewritten, paragraphOpen: open };
}

/**
 * Rewrites escaping relative link destinations for the archived depth.
 * `planDir` is the repository-relative active plan directory
 * (for example `plans/my-feature`). Only links whose target exists on disk
 * are rewritten; dangling links are left untouched with a skip note.
 *
 * Deliberate scope limits: fence detection handles top-level and
 * single block-quote containers only (deeper list/quote nesting stays
 * rewritable); raw-HTML tag detection is narrow (`<...>` with no newline,
 * so exotic markup stays rewritable). Both limits fail safe toward
 * rewriting a real link rather than hiding one behind fake protection.
 */
export function rewriteOutgoingLinks(
  markdown: string,
  planDir: string,
  existence: LinkTargetExistence,
  repositoryRoot = ".",
): LinkRewriteOutcome {
  const skipped: string[] = [];
  let rewritten = 0;
  const parts: string[] = [];
  let definitionsParagraphOpen = false;
  // Inline code spans and raw HTML may appear inside link labels, so all
  // inline links are recognized against the whole document first.
  // Block-level protection (fences, indented code) wins over inline
  // recognition: links fully inside a protected block span are dropped
  // from the exclusions, so code content never punches protection holes.
  // Only links in rewritable inline regions punch holes for their labels.
  // Block spans also drive definition tracking: a protected fence or
  // indented span ends the paragraph exactly like the block splitter's
  // endsParagraph model (one shared rule, two call sites).
  const documentLinks = findInlineLinks(markdown);
  const blockSpans = splitProtectedSpans(markdown);
  const inProtectedBlock = (link: { start: number; end: number }): boolean =>
    blockSpans.some(
      (span) =>
        span.protected_ &&
        link.start >= span.offset &&
        link.end <= span.offset + span.text.length,
    );
  const exclusions = documentLinks
    .filter((link) => !inProtectedBlock(link))
    .map((link) => ({ start: link.start, end: link.end }));
  for (const span of splitProtectedSpans(markdown, exclusions)) {
    if (span.protected_) {
      parts.push(span.text);
      // Block spans end paragraphs (same endsParagraph model as the
      // block splitter); inline code/HTML spans never do.
      if (span.kind === "fence" || span.kind === "indented") {
        definitionsParagraphOpen = false;
      }
      continue;
    }
    const spanEnd = span.offset + span.text.length;
    const owned = documentLinks.filter(
      (link) => link.start >= span.offset && link.end <= spanEnd,
    );
    const inline = rewriteOwnedLinks(
      span.text,
      span.offset,
      owned,
      planDir,
      repositoryRoot,
      existence,
      skipped,
    );
    // Paragraph state carries across spans: protection splits never end
    // a paragraph, so a definition after a paragraph line in an
    // earlier span stays lazy continuation text.
    const definitions = rewriteReferenceDefinitions(
      inline.text,
      planDir,
      repositoryRoot,
      existence,
      skipped,
      definitionsParagraphOpen,
    );
    definitionsParagraphOpen = definitions.paragraphOpen;
    rewritten += inline.rewritten + definitions.rewritten;
    parts.push(definitions.text);
  }
  return { text: parts.join(""), rewritten, skipped };
}

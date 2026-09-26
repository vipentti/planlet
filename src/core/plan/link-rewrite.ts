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
  if (isExternalDestination(split.path)) {
    return { destination, rewritten: false };
  }
  let decoded = split.path;
  try {
    decoded = decodeURIComponent(split.path);
  } catch {
    decoded = split.path;
  }
  const oldResolved = resolveLinkPath(planDir, decoded);
  // Links escaping above the repository root are never guessed at.
  if (oldResolved === null) {
    return {
      destination,
      rewritten: false,
      skipped: `outside repository: ${split.path}`,
    };
  }
  if (!escapesPlan(planDir, oldResolved)) {
    return { destination, rewritten: false };
  }
  // A pre-written archived-depth link (correct only after the move) must
  // not be rewritten again. From the active base it climbs above `plans/`
  // into a repository-root-relative target; rewriting would push it one
  // level too far. Detect it lexically: a link that resolves from the old
  // base to a path outside `plans/` entirely was authored for the archived
  // depth (or dangles), so only rewrite links that resolve inside `plans/`.
  if (!oldResolved.startsWith("plans/")) {
    return { destination, rewritten: false };
  }
  // Dangling links (no such target on disk) are never guessed at: rewriting
  // them would corrupt text no reader could have followed before the move.
  if (!existence.exists(`${repositoryRoot}/${oldResolved}`)) {
    return {
      destination,
      rewritten: false,
      skipped: `missing target: ${split.path}`,
    };
  }
  const newPath = split.angled
    ? `<${rewritePath(split.path)}>`
    : rewritePath(split.path);
  const rewritten = `${newPath}${split.suffix}`;
  return { destination: rewritten, rewritten: true };
}

/**
 * Splits Markdown text into protected spans (fenced code blocks, indented
 * code blocks, inline code spans, HTML comments) and rewritable spans.
 * Only rewritable spans are link-rewritten.
 */
function splitProtectedSpans(
  text: string,
): readonly { protected_: boolean; text: string }[] {
  const spans: { protected_: boolean; text: string }[] = [];
  const lines = text.split("\n");
  let current = "";
  let inFence = false;
  let fenceMarker = "";
  let fenceQuoted = false;

  const flush = (protected_: boolean, chunk: string): void => {
    if (chunk.length === 0) return;
    const last = spans[spans.length - 1];
    if (last !== undefined && last.protected_ === protected_) {
      last.text += chunk;
    } else {
      spans.push({ protected_, text: chunk });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const withNewline = index < lines.length - 1 ? `${line}\n` : line;
    // Fence state retains its container context: a fence opened inside a
    // block quote only closes on a quoted closer, and a top-level fence
    // only closes on a top-level closer, so a literal `> ``` line inside
    // top-level code can never terminate the block. Deeper container
    // nesting (lists inside quotes and beyond) stays out of scope and is
    // documented on rewriteOutgoingLinks.
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
        flush(true, current);
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
      current += withNewline;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      flush(false, current);
      current = "";
      flush(true, withNewline);
      continue;
    }
    current += withNewline;
  }
  flush(inFence, current);
  // Split inline code spans and HTML comments out of rewritable spans.
  // Raw HTML owns its bytes first: comment (and other tag) ranges are
  // excluded before backtick pairing, so a backtick inside HTML can never
  // pair with a visible backtick outside it. Backtick runs then scan as
  // whole delimiters per CommonMark: a span closes only on a run of
  // exactly the opener length, and spans may cross line breaks. Runs with
  // no exact-length closer are literal text.
  const result: { protected_: boolean; text: string }[] = [];
  for (const span of spans) {
    if (span.protected_) {
      result.push(span);
      continue;
    }
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
    const protectedRanges: Array<[number, number]> = [...htmlRanges];
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
        protectedRanges.push([openStart, start + length]);
        openStart = -1;
        openLength = 0;
      }
      // A longer or shorter run does not close the span: it becomes part
      // of the span body and scanning continues for an exact-length close.
    }
    // An unmatched opener protects nothing; its run stays rewritable.
    // Coalesce overlapping ranges (a comment nested inside a code span is
    // owned by the span) so slicing never duplicates or drops bytes.
    protectedRanges.sort((left, right) => left[0] - right[0]);
    const coalesced: Array<[number, number]> = [];
    for (const [start, end] of protectedRanges) {
      const last = coalesced[coalesced.length - 1];
      if (last !== undefined && start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        coalesced.push([start, end]);
      }
    }
    let cursor = 0;
    for (const [start, end] of coalesced) {
      if (start > cursor) {
        result.push({
          protected_: false,
          text: span.text.slice(cursor, start),
        });
      }
      result.push({ protected_: true, text: span.text.slice(start, end) });
      cursor = Math.max(cursor, end);
    }
    if (cursor < span.text.length) {
      result.push({ protected_: false, text: span.text.slice(cursor) });
    }
  }
  return result;
}

const REFERENCE_DEFINITION_PATTERN =
  /^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|[^\s]+)(?:(?=[ \t]*$)|(?=[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))[ \t]*$))/gm;

/** Matches a reference definition whose destination sits on the next line. */
const MULTILINE_DEFINITION_PATTERN =
  /^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*\n[ \t]+)(<[^>\n]+>|[^\s]+)(?:(?=[ \t]*$)|(?=[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))[ \t]*$))/gm;

interface InlineLinkMatch {
  readonly start: number;
  readonly end: number;
  readonly bang: string;
  readonly label: string;
  /** Full inside-parens text (destination plus optional title). */
  readonly inside: string;
  /** Decoded destination path without brackets or title. */
  readonly destination: string;
  readonly angled: boolean;
  /** Title text after an angle destination, including leading space. */
  readonly angledTitle: string;
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
    // Find the closing bracket, balancing nested brackets. One line
    // ending is allowed inside the label run.
    let cursor = open + 1;
    let depth = 0;
    let closeBracket = -1;
    let lineBreaks = 0;
    while (cursor < text.length) {
      const char = text[cursor];
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
    const afterBracket =
      closeBracket === -1
        ? null
        : allowOneLineEnding(text.slice(closeBracket + 1));
    if (
      closeBracket === -1 ||
      afterBracket === null ||
      !afterBracket.text.startsWith("(")
    ) {
      index = open + 1;
      continue;
    }
    // Parse the destination: `<...>` group (with optional title) or
    // balanced parentheses. A single line ending may precede the
    // destination and separate it from the title.
    const parenOffset = closeBracket + 1 + afterBracket.prefix;
    const destStart = parenOffset + 1;
    let destEnd = -1;
    let end = -1;
    let angled = false;
    if (text[destStart] === "<") {
      const close = text.indexOf(">", destStart + 1);
      if (close !== -1 && countLineEndings(text, destStart, close) <= 1) {
        const after = allowOneLineEnding(text.slice(close + 1));
        const tail =
          after === null
            ? null
            : /^(?:(?:"[^"\n]*(?:\n[ \t]*[^"\n]*)*"|'[^'\n]*(?:\n[ \t]*[^'\n]*)*'|\([^)\n]*(?:\n[ \t]*[^)\n]*)*\))?[ \t\n]*\))/.exec(
                after.text,
              );
        if (tail !== undefined && tail !== null && after !== null) {
          // Keep the optional title: the tail ends at the link paren, so
          // everything before its final `)` is title text.
          destEnd = close;
          end = close + 1 + after.prefix + tail[0].length;
          angled = true;
          // Rebuild inside from source offsets so the separator between
          // `>` and the title round-trips byte-identically.
          const inside = text.slice(destStart, end - 1);
          matches.push({
            start: bang.length === 0 ? open : open - 1,
            end,
            bang,
            label: text.slice(open + 1, closeBracket),
            inside,
            destination: text.slice(destStart + 1, close),
            angled,
            angledTitle: tail[0].slice(0, -1),
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
        const titleClose =
          after === null
            ? null
            : /^(?:(?:"[^"\n]*(?:\n[ \t]*[^"\n]*)*"|'[^'\n]*(?:\n[ \t]*[^'\n]*)*'|\([^)\n]*(?:\n[ \t]*[^)\n]*)*\))?[ \t\n]*\))/.exec(
                after.text,
              );
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
      // Full inside-parens text: splitDestination separates the path
      // from any title, so titled links round-trip byte-identically.
      inside: text.slice(destStart, end - 1),
      // Exclude the angle brackets: splitDestination re-adds the wrapper.
      destination: angled
        ? text.slice(destStart + 1, destEnd)
        : text.slice(destStart, destEnd),
      angled,
      angledTitle: "",
    });
    index = end;
  }
  return matches;
}

function rewriteInlineLinks(
  text: string,
  planDir: string,
  repositoryRoot: string,
  existence: LinkTargetExistence,
  skipped: string[],
): { text: string; rewritten: number } {
  let rewritten = 0;
  let cursor = 0;
  const parts: string[] = [];
  for (const found of findInlineLinks(text)) {
    const outcome = rewriteDestination(
      found.inside,
      planDir,
      repositoryRoot,
      existence,
    );
    if (outcome.skipped !== undefined) skipped.push(outcome.skipped);
    parts.push(text.slice(cursor, found.start));
    if (!outcome.rewritten) {
      parts.push(text.slice(found.start, found.end));
    } else {
      parts.push(`${found.bang}[${found.label}](${outcome.destination})`);
      rewritten += 1;
    }
    cursor = found.end;
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
): { text: string; rewritten: number } {
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
  const single = text.replace(
    REFERENCE_DEFINITION_PATTERN,
    (whole: string, _prefix: string, destination: string) =>
      rewriteOne(whole, destination),
  );
  // Reference definitions may break the destination onto the next line.
  const replaced = single.replace(
    MULTILINE_DEFINITION_PATTERN,
    (whole: string, _prefix: string, destination: string) =>
      rewriteOne(whole, destination),
  );
  return { text: replaced, rewritten };
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
  for (const span of splitProtectedSpans(markdown)) {
    if (span.protected_) {
      parts.push(span.text);
      continue;
    }
    const inline = rewriteInlineLinks(
      span.text,
      planDir,
      repositoryRoot,
      existence,
      skipped,
    );
    const definitions = rewriteReferenceDefinitions(
      inline.text,
      planDir,
      repositoryRoot,
      existence,
      skipped,
    );
    rewritten += inline.rewritten + definitions.rewritten;
    parts.push(definitions.text);
  }
  return { text: parts.join(""), rewritten, skipped };
}

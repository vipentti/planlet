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
  // Split the query/fragment suffix on semantic delimiters: a `#` or
  // `?` preceded by a backslash is escaped data, not a delimiter.
  for (let scan = 0; scan < Math.min(end, trimmed.length); scan += 1) {
    const char = trimmed[scan];
    if ((char === "#" || char === "?") && !isEscaped(trimmed, scan)) {
      end = scan;
      break;
    }
  }
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

function unescapeMarkdownPath(encodedPath: string): string {
  // Markdown backslash escapes: a backslash before escapable punctuation
  // denotes the punctuation itself. Only ASCII punctuation is escapable;
  // other backslashes (for example Windows separators) stay literal.
  return encodedPath.replace(/\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g, "$1");
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
  // Split the query/fragment suffix on semantic delimiters: a `#` or
  // `?` preceded by a backslash is escaped data (`\\#` denotes `#`),
  // while `%23` in the path is data and a bare literal starts the
  // fragment. Scan for the first unescaped delimiter.
  let pathEnd = encodedPath.length;
  for (let scan = 0; scan < encodedPath.length; scan += 1) {
    const char = encodedPath[scan];
    if ((char === "#" || char === "?") && !isEscaped(encodedPath, scan)) {
      pathEnd = scan;
      break;
    }
  }
  const pathOnly = encodedPath.slice(0, pathEnd);
  // Decode Markdown backslash escapes first (`\\(` denotes `(`), then
  // percent-encoding: the filesystem holds the semantic path.
  const unescaped = unescapeMarkdownPath(pathOnly);
  let decoded = unescaped;
  try {
    decoded = decodeURIComponent(unescaped);
  } catch {
    decoded = unescaped;
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
  /** Block kind: fence, indented, html blocks, inline code/html, text. */
  readonly kind: "fence" | "indented" | "htmlblock" | "code" | "html" | "text";
}

/** Raw HTML block state: comments run to `-->`, elements to their close
 * tag, and generic block tags to the next blank line. */
type HtmlBlockState =
  | { readonly end: "comment" }
  | { readonly end: "element"; readonly tag: string }
  | { readonly end: "blank" };

/** Block-level tag names that open a blank-terminated raw HTML block. */
const HTML_BLOCK_TAGS = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
];

/**
 * Detects a raw HTML block start on a container-stripped line. Comments
 * and script-like elements interrupt paragraphs; generic block tags
 * open only outside paragraphs. Single-line constructs stay inline:
 * only unclosed comments/elements open a block. Returns null when the
 * line is ordinary Markdown.
 */
function htmlBlockStart(stripped: string): HtmlBlockState | "line" | null {
  const comment = /^ {0,3}<!--/.exec(stripped);
  if (comment !== null) {
    return stripped.includes("-->") ? null : { end: "comment" };
  }
  const element = /^ {0,3}<(script|pre|style|textarea)(?=[\s/>]|$)/i.exec(
    stripped,
  );
  if (element !== null) {
    const tag = (element[1] ?? "").toLowerCase();
    // An opening line that also closes stays a single protected line.
    return new RegExp(`</${tag}\\s*>`, "i").test(stripped)
      ? "line"
      : { end: "element", tag };
  }
  const tagName = HTML_BLOCK_TAGS.join("|");
  const block = new RegExp(`^ {0,3}</?(?:${tagName})(?=[\\s/>]|$)`, "i").exec(
    stripped,
  );
  if (block !== null) {
    return { end: "blank" };
  }
  return null;
}

/** True when the line ends an open raw HTML block (inclusive). */
function htmlBlockEnds(state: HtmlBlockState, line: string): boolean {
  if (state.end === "comment") {
    return line.includes("-->");
  }
  if (state.end === "element") {
    return new RegExp(`</${state.tag}\\s*>`, "i").test(line);
  }
  return false;
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
 * Shared block-boundary rule over container-stripped content: blank
 * lines, ATX headings, setext underlines, and thematic breaks end a
 * paragraph. Container identity (quotes, list items) is tracked
 * separately through signatures, so a definition-looking line inside
 * an open paragraph stays lazy continuation text. Used by both the
 * block splitter (indented-code starts) and reference-definition
 * tracking, so the two models cannot disagree.
 */
function endsParagraph(line: string): boolean {
  return (
    line.trim().length === 0 ||
    /^ {0,3}#{1,6}(?:\s|$)/.test(line) ||
    /^ {0,3}(?:=+[ \t]*)$/.test(line) ||
    /^ {0,3}(?:-+[ \t]*)$/.test(line) ||
    /^ {0,3}(?:\*[ \t]*){3,}$/.test(line) ||
    /^ {0,3}(?:-[ \t]*){3,}$/.test(line) ||
    /^ {0,3}(?:_[ \t]*){3,}$/.test(line)
  );
}

/** A container marker kind in document order. */
type ContainerKind = "quote" | "list";

/**
 * Paragraph state scoped to a container signature: an open paragraph
 * continues only on lines with the same container identity that are
 * not block boundaries. A new list item always starts a fresh
 * container, so definitions there are real definitions.
 */
interface ParagraphState {
  readonly open: boolean;
  /** Container signature when open, null when no paragraph is open. */
  readonly signature: string | null;
}

function containerSignature(kinds: readonly ContainerKind[]): string {
  return kinds.join("\0");
}

/** True when `open` is a prefix of `current` (same container stack). */
function containerPrefixMatches(
  current: readonly ContainerKind[],
  open: readonly ContainerKind[],
): boolean {
  if (current.length < open.length) return false;
  return open.every((kind, index) => current[index] === kind);
}

/** True when both container stacks are identical. */
function containersEqual(
  left: readonly ContainerKind[],
  right: readonly ContainerKind[],
): boolean {
  return (
    left.length === right.length &&
    left.every((kind, index) => right[index] === kind)
  );
}

/**
 * Advances paragraph state for one ordinary content line (already
 * container-stripped). The caller gates definition recognition on the
 * pre-update `open` value, then adopts the returned state.
 */
function trackParagraph(
  state: ParagraphState,
  stripped: string,
  kinds: readonly ContainerKind[],
  consumedBullet: boolean,
): ParagraphState {
  if (endsParagraph(stripped)) {
    return { open: false, signature: null };
  }
  const signature = containerSignature(kinds);
  if (consumedBullet) {
    // A new list item starts a fresh container: lazy continuation
    // never crosses it.
    return { open: true, signature };
  }
  if (state.open && state.signature === signature) {
    // Same container, ordinary text: the paragraph continues.
    return state;
  }
  // A different container (or no open paragraph) starts a new block.
  return { open: true, signature };
}

/**
 * Strips block-quote markers (`>`) and list markers (`-`, `+`, `*`,
 * `1.`) with their container indentation, returning the container depth
 * and the remaining content. List-item content aligns at the marker
 * column: continuation lines indented to an open item content column
 * share that depth, so nested fences and code classify correctly at any
 * nesting depth.
 */
interface ContainerColumn {
  /** Container depth at which the list item opened. */
  readonly depth: number;
  /** Absolute content column of the item body. */
  readonly column: number;
}

function stripContainers(
  line: string,
  contentColumn: readonly ContainerColumn[] = [],
): {
  depth: number;
  content: string;
  /** Updated open item content columns after consuming this line. */
  columns: ContainerColumn[];
  /** Container kinds in document order (explicit + shared). */
  kinds: ContainerKind[];
  /** True when this line opened a new list item. */
  consumedBullet: boolean;
  /** Absolute column of the last consumed bullet, if any. */
  bulletColumn: number | null;
} {
  let rest = line;
  let depth = 0;
  let columns = [...contentColumn];
  let consumedBullet = false;
  let bulletColumn: number | null = null;
  const kinds: ContainerKind[] = [];
  for (;;) {
    const quote = /^ {0,3}> ?/.exec(rest);
    if (quote !== null) {
      rest = rest.slice(quote[0].length);
      depth += 1;
      kinds.push("quote");
      continue;
    }
    const bullet = /^ {0,3}(?:[-+*]|\d+[.)]) +/.exec(rest);
    if (bullet !== null) {
      // A new item closes open items at its depth or deeper.
      columns = columns.filter((entry) => entry.depth < depth);
      const markerColumn =
        line.length - rest.length + (/^ */.exec(bullet[0])?.[0].length ?? 0);
      // Any new item outside the fence's item scope ends it; keep the
      // outermost (minimum) column for that comparison.
      bulletColumn =
        bulletColumn === null
          ? markerColumn
          : Math.min(bulletColumn, markerColumn);
      columns.push({
        depth,
        column: line.length - rest.length + bullet[0].length,
      });
      rest = rest.slice(bullet[0].length);
      depth += 1;
      kinds.push("list");
      consumedBullet = true;
      continue;
    }
    break;
  }
  // Continuation lines share open item depths even after explicit outer
  // containers: `>   content` inside `> - item` aligns to the stored
  // list column relative to the current position. Entries from deeper
  // containers never apply to shallower lines, so a sibling block after
  // a list stays at its own depth.
  if (!consumedBullet) {
    for (const entry of columns) {
      const position = line.length - rest.length;
      if (entry.depth < depth) continue;
      if (entry.column <= position) continue;
      const need = entry.column - position;
      if (rest.startsWith(" ".repeat(need)) && rest.length > need) {
        rest = rest.slice(need);
        depth += 1;
        kinds.push("list");
      } else {
        break;
      }
    }
  }
  return { depth, content: rest, columns, kinds, consumedBullet, bulletColumn };
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
  let fenceKinds: ContainerKind[] = [];
  /** Content column of the fence's enclosing list item, if any. */
  let fenceItemColumn: number | null = null;
  let inHtmlBlock: HtmlBlockState | null = null;
  let htmlKinds: ContainerKind[] = [];
  let htmlDepth = 0;
  /** Content column of the HTML block's enclosing list item, if any. */
  let htmlItemColumn: number | null = null;
  let para: ParagraphState = { open: false, signature: null };
  let previousWasCode = true;
  let contentColumn: ContainerColumn[] = [];
  const canStartIndentedCode = (): boolean => !para.open || previousWasCode;
  /** Content column of the innermost list item enclosing a marker
   * column: the greatest open item column at or before it, if any. */
  const enclosingItemColumn = (markerColumn: number): number | null => {
    let found: number | null = null;
    for (const entry of contentColumn) {
      if (entry.column <= markerColumn) found = entry.column;
      else break;
    }
    return found;
  };
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
    // Classify on the line without a trailing CR so CRLF documents
    // behave exactly like LF documents; output keeps original bytes.
    const bare =
      line.endsWith("\r") && index < lines.length - 1
        ? line.slice(0, -1)
        : line;
    // Fence state retains its container depth: a fence opened at depth N
    // only closes at depth N, where depth counts arbitrary quote/list
    // nesting via stripContainers. A literal `> ``` line inside
    // top-level code can never terminate the block, and nested quoted
    // or list-contained fences classify like top-level ones. A fence
    // ends early when its container ends: a shallower line terminates
    // it and is reprocessed below. Indented code is relative to the
    // container: four spaces beyond the container indent is code at any
    // nesting depth.
    const { depth, content, columns, kinds, consumedBullet, bulletColumn } =
      stripContainers(bare, contentColumn);
    contentColumn = columns;
    const stripped = content;
    // Raw HTML blocks own their lines before fence detection: their
    // content is literal Markdown-wise. A blank line ends a
    // blank-terminated block without belonging to it.
    if (
      inHtmlBlock !== null &&
      inHtmlBlock.end === "blank" &&
      bare.trim().length === 0
    ) {
      flush(true, current, "htmlblock");
      current = "";
      inHtmlBlock = null;
      htmlKinds = [];
      htmlDepth = 0;
      para = { open: false, signature: null };
      previousWasCode = true;
      // Fall through to ordinary handling of the blank line.
    } else if (inHtmlBlock !== null) {
      if (
        !containerPrefixMatches(kinds, htmlKinds) ||
        depth < htmlDepth ||
        (consumedBullet &&
          bulletColumn !== null &&
          htmlItemColumn !== null &&
          bulletColumn < htmlItemColumn)
      ) {
        // The container ended: close the block and reprocess this line.
        flush(true, current, "htmlblock");
        current = "";
        inHtmlBlock = null;
        htmlKinds = [];
        htmlDepth = 0;
        htmlItemColumn = null;
        para = { open: false, signature: null };
        previousWasCode = true;
      } else {
        current += withNewline;
        if (htmlBlockEnds(inHtmlBlock, line)) {
          flush(true, current, "htmlblock");
          current = "";
          inHtmlBlock = null;
          htmlKinds = [];
          htmlDepth = 0;
          para = { open: false, signature: null };
          previousWasCode = true;
        }
        continue;
      }
    }
    // Fence openers allow at most three leading spaces past the
    // container; deeper indentation is indented code, never a fence.
    // Closing runs need the same character, at least the opening
    // length, and only spaces/tabs after. A backtick fence whose info
    // string holds a backtick is not a fence at all.
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(stripped);
    const fenceInfo = fenceMatch
      ? stripped.slice(
          stripped.indexOf(fenceMatch[1] ?? "") + (fenceMatch[1] ?? "").length,
        )
      : "";
    const fenceOpenerValid =
      fenceMatch !== null &&
      ((fenceMatch[1] ?? "")[0] !== "`" || !fenceInfo.includes("`"));
    if (fenceMatch !== null && (inFence || fenceOpenerValid)) {
      const marker = fenceMatch[1] ?? "";
      const markerChar = marker[0] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceKinds = [...kinds];
        fenceItemColumn = enclosingItemColumn(bare.length - stripped.length);
        flush(false, current);
        current = withNewline;
        para = { open: false, signature: null };
        previousWasCode = false;
        continue;
      } else if (
        !containerPrefixMatches(kinds, fenceKinds) ||
        depth < fenceKinds.length ||
        (consumedBullet &&
          bulletColumn !== null &&
          fenceItemColumn !== null &&
          bulletColumn < fenceItemColumn)
      ) {
        // The container changed identity or ended: close the fence
        // and reprocess this line below (it may open a new fence).
        flush(true, current, "fence");
        current = "";
        inFence = false;
        fenceMarker = "";
        fenceKinds = [];
        fenceItemColumn = null;
        para = { open: false, signature: null };
        previousWasCode = true;
      } else if (
        containersEqual(kinds, fenceKinds) &&
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
        fenceKinds = [];
        fenceItemColumn = null;
        // A fenced block ends the paragraph; later indented code may
        // start fresh.
        para = { open: false, signature: null };
        previousWasCode = true;
        continue;
      } else {
        current += withNewline;
        continue;
      }
    }
    if (inFence) {
      if (
        !containerPrefixMatches(kinds, fenceKinds) ||
        depth < fenceKinds.length ||
        (consumedBullet &&
          bulletColumn !== null &&
          fenceItemColumn !== null &&
          bulletColumn < fenceItemColumn)
      ) {
        // The container ended: close the fence and reprocess this line
        // as ordinary Markdown.
        flush(true, current, "fence");
        current = "";
        inFence = false;
        fenceMarker = "";
        fenceKinds = [];
        fenceItemColumn = null;
        para = { open: false, signature: null };
        previousWasCode = true;
      } else {
        current += withNewline;
        continue;
      }
    }
    // A fence may open here: either no fence is open, or the previous
    // one just closed because its container ended.
    if (!inFence && fenceMatch !== null && fenceOpenerValid) {
      const marker = fenceMatch[1] ?? "";
      inFence = true;
      fenceMarker = marker;
      fenceKinds = [...kinds];
      fenceItemColumn = enclosingItemColumn(bare.length - stripped.length);
      flush(false, current);
      current = withNewline;
      para = { open: false, signature: null };
      previousWasCode = false;
      continue;
    }
    // A raw HTML block opens here unless already inside a fence: its
    // content is literal. Generic block tags open only outside
    // paragraphs; comments and script-like elements interrupt.
    // Single-line constructs stay inline-handled.
    if (!inFence) {
      const htmlOpen = htmlBlockStart(stripped);
      if (htmlOpen === "line") {
        flush(false, current);
        current = "";
        flush(true, withNewline, "htmlblock");
        para = { open: false, signature: null };
        previousWasCode = true;
        continue;
      }
      if (htmlOpen !== null && (htmlOpen.end !== "blank" || !para.open)) {
        flush(false, current);
        current = withNewline;
        inHtmlBlock = htmlOpen;
        htmlItemColumn = enclosingItemColumn(bare.length - stripped.length);
        htmlKinds = [...kinds];
        htmlDepth = depth;
        para = { open: false, signature: null };
        previousWasCode = false;
        continue;
      }
    }
    // Indented code is relative to the container: content indented four
    // or more spaces past the container starts code only where CommonMark
    // permits a block start. A four-space line continuing a paragraph is
    // lazy continuation text, never code, so links there stay rewritable.
    // All tests below run on the CR-stripped line.
    const contentIndented = /^(?: {4}|\t)/.test(stripped);
    if (contentIndented && !canStartIndentedCode()) {
      // Lazy continuation: paragraph state is unchanged.
      current += withNewline;
      continue;
    }
    if (contentIndented) {
      flush(false, current);
      current = "";
      flush(true, withNewline, "indented");
      para = { open: false, signature: null };
      previousWasCode = true;
      continue;
    }
    // A fence-looking line with an invalid info string reaches here:
    // it is ordinary paragraph text, not a block boundary.
    para = trackParagraph(para, stripped, kinds, consumedBullet);
    previousWasCode = false;
    // A blank line closes open list items; other boundaries keep the
    // item open for lazy continuation lines.
    if (bare.trim().length === 0) contentColumn = [];
    current += withNewline;
  }
  flush(
    inFence || inHtmlBlock !== null,
    current,
    inHtmlBlock !== null ? "htmlblock" : inFence ? "fence" : "text",
  );
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
    // Pending openers stay eligible until an equal-length whole run
    // closes them: different-length runs never match, so `` [x] ` ``
    // protects its link while an unmatched opener stays literal. The
    // most recent matching opener pairs first, mirroring CommonMark.
    // This shares the whole-run rule with label scanning.
    const openers: Array<{ start: number; length: number }> = [];
    for (const run of runs) {
      const start = run.index ?? 0;
      const length = run[0].length;
      const matchIndex = openers.findLastIndex(
        (opener) => opener.length === length,
      );
      if (matchIndex === -1) {
        openers.push({ start, length });
        continue;
      }
      const opener = openers[matchIndex];
      if (opener !== undefined) {
        protectedRanges.push([opener.start, start + length, "code"]);
      }
      // The matched opener and everything opened after it are consumed
      // by the span.
      openers.splice(matchIndex);
    }
    // Unmatched openers protect nothing; their runs stay rewritable.
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
  /^((?:[ \t]{0,3}> ?|[ \t]{0,3}(?:[-+*]|\d+[.)]) +)*[ \t]{0,3})(\[[^\]\n\\]*(?:\\.[^\]\n\\]*)*\]:[ \t]*)(<[^>\n]+>|[^\s]+)(?:(?=[ \t]*$)|(?=[ \t]+(?:"[^"\n\\]*(?:\\.[^"\n\\]*)*"|'[^'\n\\]*(?:\\.[^'\n\\]*)*'|\([^)\n\\]*(?:\\.[^)\n\\]*)*\))[ \t]*$))/gm;

/** Matches a reference definition whose label spans two lines. */
const MULTILINE_LABEL_DEFINITION_PATTERN =
  /^((?:[ \t]{0,3}> ?|[ \t]{0,3}(?:[-+*]|\d+[.)]) +)*[ \t]{0,3})(\[(?:\\.|[^\]\\\r\n]|\r\n|\n(?!\n))*\]:[ \t]*)(<[^>\n]+>|[^\s]+)(?:(?=[ \t]*$)|(?=[ \t]+(?:"[^"\n\\]*(?:\\.[^"\n\\]*)*"|'[^'\n\\]*(?:\\.[^'\n\\]*)*'|\([^)\n\\]*(?:\\.[^)\n\\]*)*\))[ \t]*$))/;

/** Matches a definition whose title starts unclosed on the destination
 * line and closes on a later nonblank line. Groups: (container)(label +
 * colon)(separator)(destination)(separator)(title). */
const CONTINUED_TITLE_DEFINITION_PATTERN =
  /^((?:[ \t]{0,3}> ?|[ \t]{0,3}(?:[-+*]|\d+[.)]) +)*[ \t]{0,3})(\[(?:\\.|[^\]\\\r\n]|\r\n|\n(?!\n))*\]:)([ \t]*(?:\r\n|\n)?[ \t]*)(<[^>\n]+>|[^\s]+)([ \t]*(?:\r\n|\n)?[ \t]*)((?:"(?:\\.|[^"\n\\]|\r\n|\n(?!\n))*"|'(?:\\.|[^'\n\\]|\r\n|\n(?!\n))*'|\((?:\\.|[^)\n\\]|\r\n|\n(?!\n))*\)))(?=[ \t]*(?:\r\n|\n|$))/;

/** Matches a reference definition whose destination sits on the next line. */
const MULTILINE_DEFINITION_PATTERN =
  /^((?:[ \t]{0,3}> ?|[ \t]{0,3}(?:[-+*]|\d+[.)]) +)*[ \t]{0,3})(\[[^\]\n\\]*(?:\\.[^\]\n\\]*)*\]:[ \t]*\n[ \t]+)(<[^>\n]+>|[^\s]+)(?:(?=[ \t]*$)|(?=[ \t]+(?:"[^"\n\\]*(?:\\.[^"\n\\]*)*"|'[^'\n\\]*(?:\\.[^'\n\\]*)*'|\([^)\n\\]*(?:\\.[^)\n\\]*)*\))[ \t]*$))/gm;

interface InlineLinkMatch {
  readonly start: number;
  readonly end: number;
  readonly bang: string;
  readonly label: string;
  /** Byte range of the label text (between the brackets). */
  readonly labelStart: number;
  readonly labelEnd: number;
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

/** Length of the line ending at `index`: 2 for CRLF, 1 for LF or CR. */
function lineEndingLength(text: string, index: number): number {
  if (text[index] === "\r") {
    return text[index + 1] === "\n" ? 2 : 1;
  }
  return text[index] === "\n" ? 1 : 0;
}

/**
 * Length of a soft line break at `index`: a line ending that does not
 * open a blank line (which would end the paragraph). Returns 0 for
 * blank-line boundaries and non-breaks, so labels and titles may span
 * multiple nonblank lines while paragraph breaks still stop them.
 */
function softBreakLength(text: string, index: number): number {
  const length = lineEndingLength(text, index);
  if (length === 0) return 0;
  const rest = text.slice(index + length);
  const spaces = /^[ \t]*/.exec(rest)?.[0] ?? "";
  const after = rest.slice(spaces.length);
  if (after.length === 0 || after.startsWith("\r") || after.startsWith("\n")) {
    return 0;
  }
  return length;
}

/** Counts line endings (`\r\n`, `\n`, `\r`) in `text[start, end)`. */
function countLineEndings(text: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end;) {
    const length = lineEndingLength(text, index);
    if (length > 0) {
      count += 1;
      index += length;
    } else {
      index += 1;
    }
  }
  return count;
}

/**
 * Skips spaces, tabs, and at most one line ending (LF, CRLF, or CR).
 * Returns the remainder plus the skipped prefix length, or null when
 * more whitespace appears.
 */
function allowOneLineEnding(
  text: string,
): { text: string; prefix: number } | null {
  const leading = /^[ \t]*/.exec(text)?.[0] ?? "";
  let prefix = leading.length;
  const breakLength = lineEndingLength(text, prefix);
  if (breakLength > 0) {
    prefix += breakLength;
    const trailing = /^[ \t]*/.exec(text.slice(prefix))?.[0] ?? "";
    prefix += trailing.length;
  }
  const rest = text.slice(prefix);
  if (prefix === leading.length && rest.length === 0) {
    return { text: rest, prefix };
  }
  if (breakLength === 0 && /^[ \t]*(\r\n|\n|\r)/.test(rest)) return null;
  if (breakLength > 0 && /^(\r\n|\n|\r)/.test(rest)) return null;
  return { text: rest, prefix };
}

/**
 * Matches an optional title plus the link-closing paren at the start of
 * `text`: `"..."`, `'...'`, or `(...)` with backslash-escaped delimiters
 * honored. Titles may span multiple nonblank lines; a blank line ends
 * the paragraph and rejects the match. A bare suffix never matches, so
 * non-title text is rejected. Only `[0]` of the returned array is read
 * by callers.
 */
function parseTitleTail(text: string): RegExpExecArray | null {
  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === " " || char === "\t") {
      cursor += 1;
      continue;
    }
    const breakLength = softBreakLength(text, cursor);
    if (breakLength > 0) {
      cursor += breakLength;
      continue;
    }
    break;
  }
  if (cursor < text.length) {
    const char = text[cursor];
    if (char === '"' || char === "'" || char === "(") {
      const closer = char === "(" ? ")" : char;
      cursor += 1;
      let closed = false;
      while (cursor < text.length) {
        const inner = text[cursor];
        if (inner === "\\") {
          cursor += 2;
          continue;
        }
        const innerBreak = softBreakLength(text, cursor);
        if (innerBreak > 0) {
          cursor += innerBreak;
          continue;
        }
        // A blank line inside a title ends the paragraph: reject.
        if (lineEndingLength(text, cursor) > 0) return null;
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
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === " " || char === "\t") {
      cursor += 1;
      continue;
    }
    const trailingLength = softBreakLength(text, cursor);
    if (trailingLength > 0) {
      cursor += trailingLength;
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
/**
 * Finds the first backtick run of exactly `length` in `text`, where the
 * run is neither preceded nor followed by another backtick. Both sides
 * anchor on a single backtick (never the repeated run), so a longer run
 * can never furnish a suffix match. Returns the run start or -1.
 */
function findExactRun(text: string, length: number): number {
  const ticks = "`".repeat(length);
  const pattern = new RegExp(`(?<!\`)${ticks}(?!\`)`);
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
/**
 * Finds inline links with CommonMark nesting precedence: an inner
 * match voids an outer match of the same kind (its brackets stay
 * literal text), while mixed nesting coexists. Thus
 * `[outer [inner](a)](b)` yields only the inner link,
 * `[![img](a)](b)` yields both the image and the outer link, and
 * `![outer [inner](a)](b)` yields both the inner link and the outer
 * image.
 */
function findInlineLinks(text: string): InlineLinkMatch[] {
  const top = scanInlineLinks(text);
  const out: InlineLinkMatch[] = [];
  for (const match of top) {
    const inners = findInlineLinks(
      text.slice(match.labelStart, match.labelEnd),
    ).map((inner) => shiftMatch(inner, match.labelStart));
    if (inners.length > 0) out.push(...inners);
    // An outer match survives only when no inner match of the same
    // kind voids it: inner links void outer links, inner images void
    // outer images, and mixed nesting coexists.
    const voids = inners.some(
      (inner) => (inner.bang === "") === (match.bang === ""),
    );
    if (!voids) {
      out.push(match);
    }
  }
  out.sort((left, right) => left.start - right.start);
  return out;
}

/** Offsets every range of a sliced-text match back to document bytes. */
function shiftMatch(match: InlineLinkMatch, delta: number): InlineLinkMatch {
  return {
    ...match,
    start: match.start + delta,
    end: match.end + delta,
    labelStart: match.labelStart + delta,
    labelEnd: match.labelEnd + delta,
    destinationStart: match.destinationStart + delta,
    destinationEnd: match.destinationEnd + delta,
  };
}

function scanInlineLinks(text: string): InlineLinkMatch[] {
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
    // skipping inline code spans and raw HTML inside the label.
    // Labels may hold multiple soft breaks but never a blank line.
    let cursor = open + 1;
    let depth = 0;
    let closeBracket = -1;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "`") {
        // Whole-run pairing: a closer must be a run of exactly the
        // opener length, never a prefix of a longer run. An unmatched
        // opener is literal text: skip only the run and keep scanning
        // for the label close instead of abandoning the link.
        const run = /`+/.exec(text.slice(cursor))?.[0] ?? "`";
        const rest = text.slice(cursor + run.length);
        const closer = findExactRun(rest, run.length);
        if (closer === -1) {
          cursor += run.length;
          continue;
        }
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
      if (char === "\r" || char === "\n") {
        // A blank line ends the paragraph and the label.
        const breakLength = softBreakLength(text, cursor);
        if (breakLength === 0) break;
        cursor += breakLength;
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
      // A link destination never contains a line ending: angled
      // destinations with newlines stay byte-identical.
      if (close !== -1 && countLineEndings(text, destStart, close) === 0) {
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
            labelStart: open + 1,
            labelEnd: closeBracket,
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
          (char === " " || char === "\t" || lineEndingLength(text, cursor) > 0)
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
      labelStart: open + 1,
      labelEnd: closeBracket,
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

interface DefinitionMatch {
  /** Byte range of the whole owned definition (label, destination, title). */
  readonly start: number;
  readonly end: number;
  /** Byte range of the destination path only. */
  readonly destinationStart: number;
  readonly destinationEnd: number;
  readonly destination: string;
}

/**
 * Recognizes reference definitions against the original block stream
 * and records exact destination byte offsets. Runs before inline
 * code/HTML splitting, so titles holding paired backticks never
 * fragment recognition, and definition-owned ranges (including titles)
 * are excluded from inline-link recognition. A definition line
 * continuing an open paragraph is lazy continuation text and never
 * matches. Lines inside fenced/indented blocks are code, never
 * definitions. A complete single-line definition never consumes the
 * next line, so a real inline link below a definition stays visible.
 */
function findReferenceDefinitions(
  markdown: string,
  blockSpans: readonly ProtectedSpan[],
): DefinitionMatch[] {
  const matches: DefinitionMatch[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let para: ParagraphState = { open: false, signature: null };
  let contentColumn: ContainerColumn[] = [];
  const lineIsCode = (lineStart: number): boolean =>
    blockSpans.some(
      (span) =>
        (span.kind === "fence" ||
          span.kind === "indented" ||
          span.kind === "htmlblock") &&
        lineStart >= span.offset &&
        lineStart < span.offset + span.text.length,
    );
  const matchSingle = (
    candidate: string,
  ): { destination: string; destinationLength: number } | null => {
    REFERENCE_DEFINITION_PATTERN.lastIndex = 0;
    const probe = REFERENCE_DEFINITION_PATTERN.exec(candidate);
    REFERENCE_DEFINITION_PATTERN.lastIndex = 0;
    if (probe === null) return null;
    // Groups: (container)(label+colon)(destination). The pattern
    // consumes no trailing title bytes (lookahead only).
    const container = probe[1] ?? "";
    const label = probe[2] ?? "";
    const destination = probe[3] ?? "";
    return {
      destination,
      destinationLength: container.length + label.length,
    };
  };
  const matchMultiline = (
    candidate: string,
  ): { destination: string } | null => {
    MULTILINE_DEFINITION_PATTERN.lastIndex = 0;
    const probe = MULTILINE_DEFINITION_PATTERN.exec(candidate);
    MULTILINE_DEFINITION_PATTERN.lastIndex = 0;
    if (probe === null) return null;
    // Destination offsets resolve in original bytes at the call site:
    // only the destination text travels here.
    return { destination: probe[3] ?? "" };
  };
  // A title may sit on its own line after the definition: such a line
  // is definition-owned, never a live link. Returns its line length,
  // or null when the line is not a bare title.
  const titleOnlyPattern =
    /^[ \t]+(?:"[^"\n\\]*(?:\\.[^"\n\\]*)*"|'[^'\n\\]*(?:\\.[^'\n\\]*)*'|\([^)\n\\]*(?:\\.[^)\n\\]*)*\))[ \t]*$/;
  const titleOnlyLength = (lineBare: string): number | null =>
    titleOnlyPattern.test(lineBare) ? lineBare.length : null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const lineStart = offset;
    offset += line.length + 1;
    if (lineIsCode(lineStart)) {
      para = { open: false, signature: null };
      continue;
    }
    // Match on the CR-stripped line so CRLF documents behave like LF;
    // offsets below stay in original bytes (the CR sits at the line
    // end, past every recorded offset).
    const bare = line.endsWith("\r") ? line.slice(0, -1) : line;
    // Container-stripped content drives the shared paragraph model:
    // `> [id]: ...` inside an open quote paragraph stays lazy
    // continuation text, while a new list item starts fresh.
    const strippedContainers = stripContainers(bare, contentColumn);
    contentColumn = strippedContainers.columns;
    if (bare.trim().length === 0) contentColumn = [];
    const stripped = strippedContainers.content;
    const kinds = strippedContainers.kinds;
    const consumedBullet = strippedContainers.consumedBullet;
    // Lazy continuation gate: this line is paragraph text (not a
    // definition) only when a paragraph is open in the SAME container
    // and no new list item starts here. A container change always
    // starts a fresh block.
    const lazy =
      para.open &&
      para.signature === containerSignature(kinds) &&
      !consumedBullet;
    const singleFirst = matchSingle(bare);
    if (singleFirst !== null) {
      if (lazy) {
        // Lazy paragraph text, not a definition: normal tracking, and
        // the following line stays unconsumed.
        para = trackParagraph(para, stripped, kinds, consumedBullet);
        continue;
      }
      {
        const destinationStart = lineStart + singleFirst.destinationLength;
        let end = lineStart + line.length;
        // A title on the following line belongs to the definition.
        const titleNext =
          lineIndex + 1 < lines.length ? lines[lineIndex + 1] : null;
        const titleNextBare =
          titleNext === null || titleNext === undefined
            ? null
            : titleNext.endsWith("\r")
              ? titleNext.slice(0, -1)
              : titleNext;
        if (titleNextBare !== null && titleOnlyLength(titleNextBare) !== null) {
          end += 1 + (titleNext ?? "").length;
          offset += (titleNext ?? "").length + 1;
          lineIndex += 1;
        }
        matches.push({
          start: lineStart,
          // Own the whole line (plus a later-line title) so titles
          // stay definition-owned.
          end,
          destinationStart,
          destinationEnd: destinationStart + singleFirst.destination.length,
          destination: singleFirst.destination,
        });
      }
      para = { open: false, signature: null };
      continue;
    }
    // A definition destination may sit on the next line: join the pair
    // for matching.
    const next = lineIndex + 1 < lines.length ? lines[lineIndex + 1] : null;
    const nextBare =
      next === null || next === undefined
        ? null
        : next.endsWith("\r")
          ? next.slice(0, -1)
          : next;
    const joined =
      nextBare !== null && /^[ \t]+\S/.test(nextBare)
        ? `${bare}\n${nextBare}`
        : null;
    if (joined !== null) {
      const found = matchMultiline(joined);
      if (found !== null) {
        if (lazy) {
          // Lazy paragraph text: normal tracking, following lines stay
          // unconsumed.
          para = trackParagraph(para, stripped, kinds, consumedBullet);
          continue;
        }
        {
          // Destination offsets in original bytes: the destination
          // opens the next line after its leading whitespace.
          const nextStart = lineStart + line.length + 1;
          const indent = /^[ \t]+/.exec(nextBare ?? "")?.[0] ?? "";
          const destinationStart = nextStart + indent.length;
          let end = nextStart + (next ?? "").length;
          // A title on the third line belongs to the definition.
          const titleThird =
            lineIndex + 2 < lines.length ? lines[lineIndex + 2] : null;
          const titleThirdBare =
            titleThird === null || titleThird === undefined
              ? null
              : titleThird.endsWith("\r")
                ? titleThird.slice(0, -1)
                : titleThird;
          if (
            titleThirdBare !== null &&
            titleOnlyLength(titleThirdBare) !== null
          ) {
            end += 1 + (titleThird ?? "").length;
            offset += (titleThird ?? "").length + 1;
            lineIndex += 1;
          }
          matches.push({
            start: lineStart,
            // Original bytes: both lines plus the line ending between.
            end,
            destinationStart,
            destinationEnd: destinationStart + found.destination.length,
            destination: found.destination,
          });
        }
        // Consume the pair: the destination line cannot start a
        // paragraph of its own.
        para = { open: false, signature: null };
        offset += (next ?? "").length + 1;
        lineIndex += 1;
        continue;
      }
    }
    // A label split across two lines: join the pair in original bytes
    // when the first line holds an unclosed bracket, then match the
    // label-tolerant pattern.
    const unescaped = bare.replace(/\\./g, "");
    if (/\[[^\]]*$/.test(unescaped)) {
      const labelNext =
        lineIndex + 1 < lines.length ? lines[lineIndex + 1] : null;
      if (labelNext !== null && labelNext !== undefined) {
        const separator = line.endsWith("\r") ? "\r\n" : "\n";
        const pair = `${line}${separator}${labelNext}`;
        MULTILINE_LABEL_DEFINITION_PATTERN.lastIndex = 0;
        const labelProbe = MULTILINE_LABEL_DEFINITION_PATTERN.exec(pair);
        MULTILINE_LABEL_DEFINITION_PATTERN.lastIndex = 0;
        if (labelProbe !== null) {
          if (lazy) {
            // Lazy paragraph text: normal tracking, following lines stay
            // unconsumed.
            para = trackParagraph(para, stripped, kinds, consumedBullet);
            continue;
          }
          {
            const container = labelProbe[1] ?? "";
            const label = labelProbe[2] ?? "";
            const destination = labelProbe[3] ?? "";
            const destinationStart =
              lineStart + container.length + label.length;
            matches.push({
              start: lineStart,
              end: lineStart + pair.length,
              destinationStart,
              destinationEnd: destinationStart + destination.length,
              destination,
            });
          }
          para = { open: false, signature: null };
          offset += labelNext.length + separator.length;
          lineIndex += 1;
          continue;
        }
      }
    }
    // A title that starts unclosed on the destination line and closes
    // on a later nonblank line: match the whole block in original
    // bytes so the title stays definition-owned. Runs only when the
    // strict single/multiline paths above found nothing.
    {
      // Rebuild the tail in original bytes from this line onward
      // (capped: titles cannot usefully span more).
      let tail = lines[lineIndex] ?? "";
      for (
        let tailIndex = lineIndex + 1;
        tailIndex < lines.length && tailIndex <= lineIndex + 8;
        tailIndex += 1
      ) {
        const previous = lines[tailIndex - 1] ?? "";
        tail += `${previous.endsWith("\r") ? "\r\n" : "\n"}${lines[tailIndex] ?? ""}`;
      }
      CONTINUED_TITLE_DEFINITION_PATTERN.lastIndex = 0;
      const continued = CONTINUED_TITLE_DEFINITION_PATTERN.exec(tail);
      CONTINUED_TITLE_DEFINITION_PATTERN.lastIndex = 0;
      if (continued !== null) {
        const matched = continued[0] ?? "";
        if (lazy) {
          // Lazy paragraph text: normal tracking, following lines stay
          // unconsumed.
          para = trackParagraph(para, stripped, kinds, consumedBullet);
          continue;
        }
        {
          const container = continued[1] ?? "";
          const label = continued[2] ?? "";
          const separator = continued[3] ?? "";
          const destination = continued[4] ?? "";
          const destinationStart =
            lineStart + container.length + label.length + separator.length;
          matches.push({
            start: lineStart,
            end: lineStart + matched.length,
            destinationStart,
            destinationEnd: destinationStart + destination.length,
            destination,
          });
        }
        // Consume the covered lines (the current line was already
        // counted at the top of the loop).
        const covered = countLineEndings(tail, 0, matched.length);
        for (let step = 0; step < covered; step += 1) {
          lineIndex += 1;
          const consumed = lines[lineIndex] ?? "";
          offset += consumed.length + 1;
        }
        para = { open: false, signature: null };
        continue;
      }
    }
    // Indented lines never change paragraph state here: inside an open
    // paragraph they are lazy continuation text, outside one they
    // cannot open anything (code lines return early above).
    if (/^(?: {4}|\t)/.test(stripped)) {
      continue;
    }
    para = trackParagraph(para, stripped, kinds, consumedBullet);
    continue;
  }
  return matches;
}

/**
 * Rewrites escaping relative link destinations for the archived depth.
 * `planDir` is the repository-relative active plan directory
 * (for example `plans/my-feature`). Only links whose target exists on disk
 * are rewritten; dangling links are left untouched with a skip note.
 *
 * Recognition order is definition-first: reference definitions are
 * recognized against the original block stream with exact destination
 * offsets, and their owned ranges are excluded from inline-link
 * recognition. Definition titles holding link-looking text are therefore
 * never treated as real links, and inline code inside titles never
 * fragments definition recognition. Inline links splice only
 * destination-path bytes, so whitespace and titles round-trip exactly.
 */
export function rewriteOutgoingLinks(
  markdown: string,
  planDir: string,
  existence: LinkTargetExistence,
  repositoryRoot = ".",
): LinkRewriteOutcome {
  const skipped: string[] = [];
  // Block spans come from one unexcluded split; definitions derive from
  // the same stream, so fence/indented ownership is exact.
  const blockSpans = splitProtectedSpans(markdown);
  const definitions = findReferenceDefinitions(markdown, blockSpans);
  const definitionOwned = definitions.map((definition) => ({
    start: definition.start,
    end: definition.end,
  }));
  // Inline code spans and raw HTML may appear inside link labels, so all
  // inline links are recognized against the whole document first, but
  // never inside definition-owned ranges. Block-level protection
  // (fences, indented code) wins over inline recognition: links fully
  // inside a protected block span are dropped from the exclusions, so
  // code content never punches protection holes. Only links in
  // rewritable inline regions punch holes for their labels.
  const documentLinks = findInlineLinks(markdown).filter(
    (link) =>
      !definitionOwned.some(
        (owned) => link.start >= owned.start && link.end <= owned.end,
      ),
  );
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
  const spans = splitProtectedSpans(markdown, exclusions);
  // All edits splice the original source in one ordered pass: inline
  // destinations and definition destinations share one offset space,
  // so no pass can shift a later pass's offsets.
  interface Splice {
    readonly start: number;
    readonly end: number;
    readonly insert: string;
  }
  const splices: Splice[] = [];
  const rewritable = (start: number, end: number): boolean =>
    spans.some(
      (span) =>
        !span.protected_ &&
        start >= span.offset &&
        end <= span.offset + span.text.length,
    );
  for (const link of documentLinks) {
    if (!rewritable(link.start, link.end)) continue;
    const rawPath = markdown.slice(link.destinationStart, link.destinationEnd);
    const encodedPath =
      link.angled && rawPath.startsWith("<") && rawPath.endsWith(">")
        ? rawPath.slice(1, -1)
        : rawPath;
    const classified = classifyDestinationPath(
      encodedPath,
      planDir,
      repositoryRoot,
      existence,
    );
    if (classified.skipped !== undefined) skipped.push(classified.skipped);
    if (classified.rewritten === null) continue;
    splices.push({
      start: link.destinationStart,
      end: link.destinationEnd,
      insert: classified.rewritten,
    });
  }
  for (const definition of definitions) {
    // Skip definitions inside fenced/indented blocks (code, never
    // definitions); inline fragmentation never blocks them because
    // recognition ran on the block stream.
    const inBlock = blockSpans.some(
      (span) =>
        (span.kind === "fence" ||
          span.kind === "indented" ||
          span.kind === "htmlblock") &&
        definition.start >= span.offset &&
        definition.end <= span.offset + span.text.length,
    );
    if (inBlock) continue;
    const outcome = rewriteDestination(
      definition.destination,
      planDir,
      repositoryRoot,
      existence,
    );
    if (outcome.skipped !== undefined) skipped.push(outcome.skipped);
    if (!outcome.rewritten) continue;
    splices.push({
      start: definition.destinationStart,
      end: definition.destinationEnd,
      insert: outcome.destination,
    });
  }
  splices.sort((left, right) => left.start - right.start);
  // Refuse overlapping edits rather than corrupting bytes: keep the
  // first and report the rest as skipped.
  const applied: Splice[] = [];
  for (const splice of splices) {
    const last = applied[applied.length - 1];
    if (last !== undefined && splice.start < last.end) {
      skipped.push("overlapping link ranges left unchanged");
      continue;
    }
    applied.push(splice);
  }
  let cursor = 0;
  const out: string[] = [];
  for (const splice of applied) {
    out.push(markdown.slice(cursor, splice.start));
    out.push(splice.insert);
    cursor = splice.end;
  }
  out.push(markdown.slice(cursor));
  return { text: out.join(""), rewritten: applied.length, skipped };
}

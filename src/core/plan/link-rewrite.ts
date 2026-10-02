import {
  fromMarkdown,
  type CompileContext,
  type Extension,
  type Token,
} from "mdast-util-from-markdown";
import { decodeString } from "micromark-util-decode-string";

const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const QUERY_OR_FRAGMENT_PATTERN = /[?#]/;
const PREFIX = "../";

type Reason =
  | "unresolved target"
  | "ambiguous target"
  | "reaches planlet through its parent directory"
  | "invalid path";

type Decision =
  | { readonly kind: "skip" }
  | { readonly kind: "rewrite" }
  | { readonly kind: "note"; readonly reason: Reason };

export interface LinkRewriteOptions {
  /** File name used in warning notes, for example `plan.md`. */
  readonly fileName: string;
  /** Repository-relative, `/`-separated active planlet directory. */
  readonly planDir: string;
  /** Repository-relative, `/`-separated archive directory. */
  readonly archiveDir: string;
  /** Whether a repository-relative path exists. May throw. */
  readonly exists: (path: string) => boolean;
  readonly text: string;
}

export interface LinkRewriteResult {
  readonly text: string;
  readonly rewrites: number;
  readonly notes: readonly string[];
}

interface Destination {
  /** Offset where `../` is inserted, after an opening `<`. */
  readonly offset: number;
  /** Destination text without angle brackets, for notes. */
  readonly raw: string;
}

interface Target {
  /** Repository-relative target, or `null` when it climbs above the root. */
  readonly path: string | null;
  /** Whether resolution never left the base directory. */
  readonly withinBase: boolean;
}

/**
 * Resolves `target` against `base` one segment at a time, so a path that climbs
 * out of `base` and back in stays recognizable as a reference through the
 * parent directory. `posix.resolve()` would normalize that history away, and
 * it silently clamps a path that climbs above the repository root.
 */
function resolveTarget(base: string, target: string): Target {
  const segments = base.split("/");
  const baseDepth = segments.length;
  let withinBase = true;
  let escaped = false;
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (segments.length === 0) {
      escaped = true;
      continue;
    }
    segments.pop();
    withinBase &&= segments.length >= baseDepth;
  }
  return {
    path: escaped ? null : segments.join("/"),
    withinBase,
  };
}

function isInside(directory: string, path: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function decide(decoded: string, options: LinkRewriteOptions): Decision {
  if (
    decoded === "" ||
    decoded.startsWith("/") ||
    decoded.startsWith("#") ||
    decoded.startsWith("?") ||
    SCHEME_PATTERN.test(decoded)
  ) {
    return { kind: "skip" };
  }

  const separator = decoded.search(QUERY_OR_FRAGMENT_PATTERN);
  const rawPath = separator === -1 ? decoded : decoded.slice(0, separator);
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return { kind: "note", reason: "invalid path" };
  }
  if (path.includes("\0")) {
    return { kind: "note", reason: "invalid path" };
  }

  // A target inside the planlet moves with it. The archive rename only breaks
  // the ones that reach it through its parent directory.
  const active = resolveTarget(options.planDir, path);
  if (active.path !== null && isInside(options.planDir, active.path)) {
    return active.withinBase
      ? { kind: "skip" }
      : {
          kind: "note",
          reason: "reaches planlet through its parent directory",
        };
  }

  // Both bases resolve the same destination text: the active location the
  // link was written for, and the archived location one level deeper.
  const archive = resolveTarget(options.archiveDir, path);
  let activeExists = false;
  let archiveExists = false;
  try {
    activeExists = active.path !== null && options.exists(active.path);
    archiveExists = archive.path !== null && options.exists(archive.path);
  } catch {
    return { kind: "note", reason: "invalid path" };
  }

  if (activeExists && !archiveExists) return { kind: "rewrite" };
  if (archiveExists && !activeExists) return { kind: "skip" };
  if (activeExists) return { kind: "note", reason: "ambiguous target" };
  return { kind: "note", reason: "unresolved target" };
}

/**
 * Adjusts relative destinations that leave the old plans tree by one `../`
 * per extra plansDir segment. Deeper trees prepend; shallower trees strip
 * matching leading `../`. Sibling planlets move with that tree, so their
 * relative links stay byte-identical.
 */
export function rewritePlanletDepthLinks(options: {
  readonly fileName: string;
  readonly planDir: string;
  readonly fromPrefix: string;
  readonly toPrefix: string;
  readonly text: string;
}): LinkRewriteResult {
  const extraDepth =
    options.toPrefix.split("/").length - options.fromPrefix.split("/").length;
  if (extraDepth === 0) {
    return { text: options.text, rewrites: 0, notes: [] };
  }
  const prefix = PREFIX.repeat(Math.abs(extraDepth));
  const edits: { readonly offset: number; readonly length: number }[] = [];
  for (const destination of collectDestinations(options.text)) {
    if (
      !leavesPlansTree(
        decodeString(destination.raw),
        options.planDir,
        options.fromPrefix,
      )
    ) {
      continue;
    }
    if (extraDepth > 0) {
      edits.push({ offset: destination.offset, length: 0 });
      continue;
    }
    const remainder = skipLeadingParentSegments(destination.raw, -extraDepth);
    if (remainder === undefined || remainder === 0) {
      continue;
    }
    edits.push({ offset: destination.offset, length: remainder });
  }
  let text = options.text;
  for (const edit of edits.toReversed()) {
    text =
      extraDepth > 0
        ? `${text.slice(0, edit.offset)}${prefix}${text.slice(edit.offset)}`
        : `${text.slice(0, edit.offset)}${text.slice(edit.offset + edit.length)}`;
  }
  return { text, rewrites: edits.length, notes: [] };
}

function skipLeadingParentSegments(
  raw: string,
  count: number,
): number | undefined {
  const markdown = decodeString(raw);
  const rawEndAfter = rawOffsetsAfterMarkdown(raw, markdown);
  if (rawEndAfter === undefined) {
    return undefined;
  }
  let index = 0;
  let skipped = 0;
  while (skipped < count) {
    const segment = readPercentPathSegment(markdown, index);
    if (segment === undefined) {
      return undefined;
    }
    if (segment.value === "" || segment.value === ".") {
      index = segment.next;
      continue;
    }
    if (segment.value !== "..") {
      return undefined;
    }
    skipped += 1;
    index = segment.next;
  }
  return index === 0 ? 0 : rawEndAfter[index - 1];
}

const MARKDOWN_ESCAPE_OR_REFERENCE =
  /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;

function rawOffsetsAfterMarkdown(
  raw: string,
  markdown: string,
): readonly number[] | undefined {
  const rawEndAfter: number[] = [];
  MARKDOWN_ESCAPE_OR_REFERENCE.lastIndex = 0;
  let last = 0;
  for (const match of raw.matchAll(MARKDOWN_ESCAPE_OR_REFERENCE)) {
    const start = match.index;
    for (let index = last; index < start; index += 1) {
      rawEndAfter.push(index + 1);
    }
    const decoded = decodeString(match[0]);
    for (let offset = 0; offset < decoded.length; offset += 1) {
      rawEndAfter.push(start + match[0].length);
    }
    last = start + match[0].length;
  }
  for (let index = last; index < raw.length; index += 1) {
    rawEndAfter.push(index + 1);
  }
  return rawEndAfter.length === markdown.length ? rawEndAfter : undefined;
}

function readPercentPathSegment(
  markdown: string,
  start: number,
): { readonly value: string; readonly next: number } | undefined {
  if (start >= markdown.length) {
    return undefined;
  }
  let index = start;
  let value = "";
  while (index < markdown.length) {
    const unit = nextPercentDecodedUnit(markdown, index);
    if (unit === undefined) {
      return undefined;
    }
    for (const char of unit.chars) {
      if (char === "?" || char === "#") {
        return value.length === 0 ? undefined : { value, next: index };
      }
      if (char === "/") {
        return { value, next: unit.next };
      }
      value += char;
    }
    index = unit.next;
  }
  return { value, next: index };
}

function nextPercentDecodedUnit(
  markdown: string,
  index: number,
): { readonly chars: string; readonly next: number } | undefined {
  const current = markdown[index];
  if (current === undefined) {
    return undefined;
  }
  if (current === "%") {
    for (const units of [1, 2, 3, 4]) {
      const end = index + 3 * units;
      const slice = markdown.slice(index, end);
      if (!/^(?:%[0-9A-Fa-f]{2})+$/.test(slice)) {
        continue;
      }
      try {
        const chars = decodeURIComponent(slice);
        if (chars.length > 0) {
          return { chars, next: end };
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }
  return { chars: current, next: index + 1 };
}

function leavesPlansTree(
  decoded: string,
  planDir: string,
  plansPrefix: string,
): boolean {
  if (
    decoded === "" ||
    decoded.startsWith("/") ||
    decoded.startsWith("#") ||
    decoded.startsWith("?") ||
    SCHEME_PATTERN.test(decoded)
  ) {
    return false;
  }
  const separator = decoded.search(QUERY_OR_FRAGMENT_PATTERN);
  const rawPath = separator === -1 ? decoded : decoded.slice(0, separator);
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (path.includes("\0")) {
    return false;
  }
  const active = resolveTarget(planDir, path);
  return active.path === null || !isInside(plansPrefix, active.path);
}

function collectDestinations(text: string): readonly Destination[] {
  const found: Destination[] = [];
  const toDestination = (token: Token): Destination => {
    const start = token.start.offset;
    const raw = text.slice(start, token.end.offset);
    const angled = raw.startsWith("<");
    return {
      offset: start + (angled ? 1 : 0),
      raw: angled ? raw.slice(1, -1) : raw,
    };
  };
  const extension: Extension = {
    enter: {
      resourceDestination: (token) => {
        found.push(toDestination(token));
      },
      definitionDestination(this: CompileContext, token) {
        // A GFM footnote such as `[^1]: ../x.md` parses as a definition.
        // Its label is normalized on the definition node before the
        // destination is entered.
        const node = this.stack.at(-1) as { identifier: string } | undefined;
        if (node === undefined || !node.identifier.startsWith("^")) {
          found.push(toDestination(token));
        }
      },
    },
  };
  fromMarkdown(text, { mdastExtensions: [extension] });
  return found;
}

/**
 * Prepends `../` to every relative link in `plan.md` or `tasks.md` that points
 * outside the planlet, because archiving moves the file one directory deeper.
 * Only the three `../` bytes are inserted: every other byte, including
 * whitespace, escapes, and line endings, is preserved.
 */
export function rewriteArchiveLinks(
  options: LinkRewriteOptions,
): LinkRewriteResult {
  const edits: number[] = [];
  const notes: string[] = [];
  for (const destination of collectDestinations(options.text)) {
    const decision = decide(decodeString(destination.raw), options);
    if (decision.kind === "rewrite") {
      edits.push(destination.offset);
    } else if (decision.kind === "note") {
      notes.push(
        `${options.fileName} link left unchanged (${decision.reason}: ${destination.raw})`,
      );
    }
  }

  let text = options.text;
  for (const offset of edits.toReversed()) {
    text = `${text.slice(0, offset)}${PREFIX}${text.slice(offset)}`;
  }
  return { text, rewrites: edits.length, notes };
}

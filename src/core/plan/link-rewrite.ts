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
 * Prepends one `../` per extra plansDir segment to destinations that leave
 * the old plans tree. Sibling planlets move with that tree, so their relative
 * links stay byte-identical.
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
  if (extraDepth < 1) {
    return { text: options.text, rewrites: 0, notes: [] };
  }
  const prefix = PREFIX.repeat(extraDepth);
  const edits: number[] = [];
  for (const destination of collectDestinations(options.text)) {
    if (
      leavesPlansTree(
        decodeString(destination.raw),
        options.planDir,
        options.fromPrefix,
      )
    ) {
      edits.push(destination.offset);
    }
  }
  let text = options.text;
  for (const offset of edits.toReversed()) {
    text = `${text.slice(0, offset)}${prefix}${text.slice(offset)}`;
  }
  return { text, rewrites: edits.length, notes: [] };
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

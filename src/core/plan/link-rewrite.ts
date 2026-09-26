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
    const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[2] ?? "";
      const markerChar = marker[0] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        flush(false, current);
        current = withNewline;
      } else if (
        markerChar === (fenceMarker[0] ?? "") &&
        marker.length >= fenceMarker.length
      ) {
        current += withNewline;
        flush(true, current);
        current = "";
        inFence = false;
        fenceMarker = "";
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
  const result: { protected_: boolean; text: string }[] = [];
  for (const span of spans) {
    if (span.protected_) {
      result.push(span);
      continue;
    }
    const inlinePattern = /(`+)[^`\n]*?\1|(<!--[\s\S]*?-->)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = inlinePattern.exec(span.text)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          protected_: false,
          text: span.text.slice(lastIndex, match.index),
        });
      }
      result.push({ protected_: true, text: match[0] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < span.text.length) {
      result.push({ protected_: false, text: span.text.slice(lastIndex) });
    }
  }
  return result;
}

const INLINE_LINK_PATTERN = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;
const REFERENCE_DEFINITION_PATTERN =
  /^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|[^\s]+)([ \t]*.*)$/gm;

function rewriteInlineLinks(
  text: string,
  planDir: string,
  repositoryRoot: string,
  existence: LinkTargetExistence,
  skipped: string[],
): { text: string; rewritten: number } {
  let rewritten = 0;
  const replaced = text.replace(
    INLINE_LINK_PATTERN,
    (whole, bang: string, label: string, destination: string) => {
      const outcome = rewriteDestination(
        destination,
        planDir,
        repositoryRoot,
        existence,
      );
      if (outcome.skipped !== undefined) skipped.push(outcome.skipped);
      if (!outcome.rewritten) return whole;
      rewritten += 1;
      return `${bang}[${label}](${outcome.destination})`;
    },
  );
  return { text: replaced, rewritten };
}

function rewriteReferenceDefinitions(
  text: string,
  planDir: string,
  repositoryRoot: string,
  existence: LinkTargetExistence,
  skipped: string[],
): { text: string; rewritten: number } {
  let rewritten = 0;
  const replaced = text.replace(
    REFERENCE_DEFINITION_PATTERN,
    (whole: string, prefix: string, destination: string, suffix: string) => {
      const outcome = rewriteDestination(
        destination,
        planDir,
        repositoryRoot,
        existence,
      );
      if (outcome.skipped !== undefined) skipped.push(outcome.skipped);
      if (!outcome.rewritten) return whole;
      rewritten += 1;
      return `${prefix}${outcome.destination}${suffix}`;
    },
  );
  return { text: replaced, rewritten };
}

/**
 * Rewrites escaping relative link destinations for the archived depth.
 * `planDir` is the repository-relative active plan directory
 * (for example `plans/my-feature`). Only links whose target exists on disk
 * are rewritten; dangling links are left untouched with a skip note.
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

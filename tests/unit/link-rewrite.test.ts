import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveLinkPath,
  rewriteOutgoingLinks,
  type LinkTargetExistence,
} from "../../src/core/plan/link-rewrite.js";

const PLAN_DIR = "plans/link-plan";

const EXISTING: LinkTargetExistence = {
  exists: (absolutePath) =>
    absolutePath.endsWith("plans/other-plan/plan.md") ||
    absolutePath.endsWith("plans/other-plan/plan.md#section") ||
    absolutePath.endsWith("plans/other-plan/foo(bar).md") ||
    absolutePath.endsWith("plans/other-plan/image.png") ||
    absolutePath.endsWith("plans/my docs/x.md"),
};

function rewrite(input: string): ReturnType<typeof rewriteOutgoingLinks> {
  return rewriteOutgoingLinks(input, PLAN_DIR, EXISTING, "/repo");
}

test("internal links, anchors, and external URLs pass through unchanged", () => {
  for (const input of [
    "[sibling](notes.md)",
    "[anchor](#summary)",
    "[sibling anchor](notes.md#details)",
    "![diagram](assets/diagram.png)",
    "[absolute](/README.md)",
    "[external](https://example.com/docs)",
    "[protocol-relative](//example.com/docs)",
    "[mail](mailto:someone@example.com)",
    "[pre-written](../../docs/proposal.md)",
    "[outside](../../../../etc/passwd)",
  ]) {
    const outcome = rewrite(input);
    assert.equal(outcome.text, input);
    assert.equal(outcome.rewritten, 0);
  }
});

test("escaping links gain exactly one parent level", () => {
  const outcome = rewrite(
    '[cross](../other-plan/plan.md) and [titled](../other-plan/plan.md "Title")',
  );
  assert.equal(
    outcome.text,
    '[cross](../../other-plan/plan.md) and [titled](../../other-plan/plan.md "Title")',
  );
  assert.equal(outcome.rewritten, 2);
});

test("dangling links under plans/ are left untouched with a skip note", () => {
  const input = "[missing](../missing/plan.md)";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
  assert.deepEqual(outcome.skipped, ["missing target: ../missing/plan.md"]);
});

test("reference definitions are rewritten while usages stay intact", () => {
  const outcome = rewrite(
    "See [ref][target].\n\n[target]: ../other-plan/plan.md\n",
  );
  assert.equal(
    outcome.text,
    "See [ref][target].\n\n[target]: ../../other-plan/plan.md\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("angle-bracket destinations keep their wrapper while prefixed", () => {
  const outcome = rewrite("[x](<../other-plan/plan.md>)");
  assert.equal(outcome.text, "[x](<../../other-plan/plan.md>)");
  assert.equal(outcome.rewritten, 1);
  const spaced = rewriteOutgoingLinks(
    "[x](<../my docs/x.md>)",
    PLAN_DIR,
    EXISTING,
    "/repo",
  );
  assert.equal(spaced.text, "[x](<../../my docs/x.md>)");
  assert.equal(spaced.rewritten, 1);
});

test("code spans, code blocks, and comments are never rewritten", () => {
  const input =
    "```\n[x](../other-plan/plan.md)\n```\n\n" +
    "    [indented](../other-plan/plan.md)\n\n" +
    "`[inline](../other-plan/plan.md)` and <!-- [comment](../other-plan/plan.md) -->\n\n" +
    "[real](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[real](../../other-plan/plan.md)"));
  assert.ok(outcome.text.includes("```\n[x](../other-plan/plan.md)\n```"));
  assert.ok(outcome.text.includes("`[inline](../other-plan/plan.md)`"));
});

test("longer fences stay open past shorter inner fences", () => {
  const input =
    "````\n```\n[x](../other-plan/plan.md)\n```\n````\n\n[real](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[x](../other-plan/plan.md)"));
  assert.ok(outcome.text.includes("[real](../../other-plan/plan.md)"));
});

test("mismatched inline-code backtick runs do not protect the span", () => {
  // `` [x](...) ` is one literal backtick plus text plus a lone backtick,
  // not a code span, so the link is genuinely visible and must be rewritten.
  const outcome = rewrite("`` [x](../other-plan/plan.md) `\n");
  assert.equal(outcome.rewritten, 1);
});

test("URL-encoded paths and fragments survive the prefix edit", () => {
  const outcome = rewrite("[docs](../my%20docs/x.md#section)");
  assert.equal(outcome.text, "[docs](../../my%20docs/x.md#section)");
  assert.equal(outcome.rewritten, 1);
});

test("backslashes are literal characters, never separators", () => {
  const input = "[win](notes\\copy.md)";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("above-root escapes are skipped with a note", () => {
  const outcome = rewrite("[o](../../../../etc/x)");
  assert.equal(outcome.text, "[o](../../../../etc/x)");
  assert.equal(outcome.rewritten, 0);
  assert.equal(outcome.skipped.length, 1);
});

test("rewriting is idempotent", () => {
  const once = rewrite("[x](../other-plan/plan.md)");
  const twice = rewriteOutgoingLinks(once.text, PLAN_DIR, EXISTING, "/repo");
  assert.equal(twice.rewritten, 0);
  assert.equal(twice.text, once.text);
});

test("balanced-parenthesis destinations are rewritten", () => {
  const outcome = rewrite("[x](../other-plan/foo(bar).md)");
  assert.equal(outcome.text, "[x](../../other-plan/foo(bar).md)");
  assert.equal(outcome.rewritten, 1);
  const image = rewrite("![a](../other-plan/foo(bar).md)");
  assert.equal(image.text, "![a](../../other-plan/foo(bar).md)");
});

test("escaped brackets are not links", () => {
  const input = "\\[x](../other-plan/plan.md)";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("indented fence-looking text is indented code, not a fence", () => {
  const input = "    ```\n    [x](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("fence close with trailing text does not close the fence", () => {
  const input =
    "```\ncode\n```not-a-close\n[x](../other-plan/plan.md)\n```\n\n[after](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[x](../other-plan/plan.md)"));
  assert.ok(outcome.text.includes("[after](../../other-plan/plan.md)"));
});

test("shorter backtick runs inside longer inline spans stay protected", () => {
  const input = "`` `a` and `b` `` then [y](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("`` `a` and `b` ``"));
  assert.ok(outcome.text.includes("[y](../../other-plan/plan.md)"));
});

test("multiline code spans stay protected", () => {
  const input =
    "`start\n[x](../other-plan/plan.md)\nend` then [y](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[x](../other-plan/plan.md)"));
  assert.ok(outcome.text.includes("[y](../../other-plan/plan.md)"));
});

test("a longer unmatched run does not protect the link", () => {
  const outcome = rewrite("`` opener\n\n[x](../other-plan/plan.md)\n\n```\n");
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[x](../../other-plan/plan.md)"));
});

test("backslash parity decides escaped brackets", () => {
  const real = rewrite("\\\\[x](../other-plan/plan.md)");
  assert.equal(real.rewritten, 1);
  const escaped = rewrite("\\[x](../other-plan/plan.md)");
  assert.equal(escaped.rewritten, 0);
});

test("angle destinations keep their optional title", () => {
  const outcome = rewrite('[x](<../other-plan/plan.md> "Title")');
  assert.equal(outcome.text, '[x](<../../other-plan/plan.md> "Title")');
  assert.equal(outcome.rewritten, 1);
});

test("nested label brackets balance", () => {
  const outcome = rewrite("[a [b] c](../other-plan/plan.md)");
  assert.equal(outcome.text, "[a [b] c](../../other-plan/plan.md)");
  assert.equal(outcome.rewritten, 1);
});

test("a comment nested in a code span changes no bytes", () => {
  const input = "`a <!-- c --> b`\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("fenced code inside block quotes stays protected", () => {
  const input =
    "> ```\n> [x](../other-plan/plan.md)\n> ```\n\n[y](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("> [x](../other-plan/plan.md)"));
  assert.ok(outcome.text.includes("[y](../../other-plan/plan.md)"));
});

test("parentheses inside quoted titles do not break the destination", () => {
  const outcome = rewrite('[x](../other-plan/plan.md "title(with")');
  assert.equal(outcome.text, '[x](../../other-plan/plan.md "title(with")');
  assert.equal(outcome.rewritten, 1);
});

test("multiline reference definitions rewrite on the next line", () => {
  const outcome = rewrite("[r][i]\n\n[i]:\n  ../other-plan/plan.md\n");
  assert.equal(outcome.text, "[r][i]\n\n[i]:\n  ../../other-plan/plan.md\n");
  assert.equal(outcome.rewritten, 1);
});

test("a quoted-fence line inside top-level code never closes it", () => {
  const input = "```\ncode\n> ```\n[x](../other-plan/plan.md)\n```\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a backtick inside raw HTML cannot pair outward", () => {
  const input = "x <!-- ` --> [x](../other-plan/plan.md) `\n";
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[x](../../other-plan/plan.md)"));
});

test("a same-line comment owns the whole line", () => {
  const input = "<!-- x --> [x](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a line-broken inline link with a title is rewritten", () => {
  const input = '[x](../other-plan/plan.md\n "Title")';
  const outcome = rewrite(input);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("../../other-plan/plan.md"));
  assert.ok(outcome.text.includes('"Title"'));
});

test("an invalid reference-looking line stays byte-identical", () => {
  const input = "[id]: ../other-plan/plan.md garbage\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a quoted fence ends when its quote container ends", () => {
  const outcome = rewrite("> ```\n[x](../other-plan/plan.md)\n");
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[x](../../other-plan/plan.md)"));
});

test("indented paragraph continuations stay rewritable", () => {
  const outcome = rewrite("Foo\n    [x](../other-plan/plan.md)\n");
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[x](../../other-plan/plan.md)"));
});

test("no space is allowed between label and paren", () => {
  const input = "[x] (../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("whitespace after the opening paren is allowed", () => {
  const outcome = rewrite("[x](   ../other-plan/plan.md)\n");
  assert.equal(outcome.text, "[x](   ../../other-plan/plan.md)\n");
  assert.equal(outcome.rewritten, 1);
});

test("a line ending after the opening paren is preserved", () => {
  const outcome = rewrite("[x](\n   ../other-plan/plan.md\n)");
  assert.equal(outcome.text, "[x](\n   ../../other-plan/plan.md\n)");
  assert.equal(outcome.rewritten, 1);
});

test("trailing whitespace before the paren is preserved", () => {
  const outcome = rewrite('[x](../other-plan/plan.md   "T"   )');
  assert.equal(outcome.text, '[x](../../other-plan/plan.md   "T"   )');
  assert.equal(outcome.rewritten, 1);
});

test("a shorter backtick opener never closes on a longer run", () => {
  const input = "[a `` b ``` c](../other-plan/plan.md)";
  const outcome = rewrite(input);
  assert.equal(outcome.text, "[a `` b ``` c](../../other-plan/plan.md)");
  assert.equal(outcome.rewritten, 1);
});

test("escaped delimiters inside titles are honored", () => {
  const outcome = rewrite('[x](../other-plan/plan.md "a\\"b")');
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("../../other-plan/plan.md"));
});

test("inline code inside link labels does not split the link", () => {
  const outcome = rewrite("[a `b` c](../other-plan/plan.md)\n");
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[a `b` c](../../other-plan/plan.md)"));
});

test("a definition after a paragraph line is lazy continuation", () => {
  const input = "Foo\n[id]: ../other-plan/plan.md\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a quoted reference definition is recognized", () => {
  const outcome = rewrite("> [id]: ../other-plan/plan.md\n");
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("> [id]: ../../other-plan/plan.md"));
});

test("a sibling block after a list keeps its own depth", () => {
  const outcome = rewrite("- a\n> quoted [x](../other-plan/plan.md)\n");
  assert.equal(outcome.text, "- a\n> quoted [x](../../other-plan/plan.md)\n");
  assert.equal(outcome.rewritten, 1);
});

test("a paragraph, heading, then indented code protects the link", () => {
  const input = "Foo\n# H\n    [x](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a definition after a heading is recognized", () => {
  const outcome = rewrite("# H\n[id]: ../other-plan/plan.md\n");
  assert.equal(outcome.text, "# H\n[id]: ../../other-plan/plan.md\n");
  assert.equal(outcome.rewritten, 1);
});

test("a definition after a fenced block is recognized", () => {
  const input = "Foo\n\n```\ncode\n```\n[id]: ../other-plan/plan.md\n";
  const outcome = rewrite(input);
  assert.equal(
    outcome.text,
    "Foo\n\n```\ncode\n```\n[id]: ../../other-plan/plan.md\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("a shorter backtick opener never closes on a longer run", () => {
  const outcome = rewrite("[a `` b ``` c](../other-plan/plan.md)");
  assert.equal(outcome.text, "[a `` b ``` c](../../other-plan/plan.md)");
  assert.equal(outcome.rewritten, 1);
});

test("an unmatched backtick in the label stays literal", () => {
  const outcome = rewrite("[a ` b](../other-plan/plan.md)");
  assert.equal(outcome.text, "[a ` b](../../other-plan/plan.md)");
  assert.equal(outcome.rewritten, 1);
});

test("escaped punctuation resolves to the semantic target", () => {
  const outcome = rewrite("[x](../other-plan/foo\\(bar\\).md)");
  assert.equal(outcome.text, "[x](../../other-plan/foo\\(bar\\).md)");
  assert.equal(outcome.rewritten, 1);
});

test("escaped fragment and query punctuation resolve semantically", () => {
  const frag = rewrite("[x](../other-plan/plan.md\\#section)");
  assert.equal(frag.text, "[x](../../other-plan/plan.md\\#section)");
  assert.equal(frag.rewritten, 1);
});

test("nested quote/list fences protect code links", () => {
  for (const input of [
    "> > ```\n> > [x](../other-plan/plan.md)\n> > ```\n",
    "> - ```\n>   [x](../other-plan/plan.md)\n>   ```\n",
    "- ```\n  [x](../other-plan/plan.md)\n  ```\n",
    "- item\n\n      [x](../other-plan/plan.md)\n",
  ]) {
    const outcome = rewrite(input);
    assert.equal(outcome.text, input);
    assert.equal(outcome.rewritten, 0);
  }
});

test("a sibling item ends the previous item fence", () => {
  const outcome = rewrite(
    "> ```\n> code\n> ```\n- ```\n- [x](../other-plan/plan.md)\n- ```\n",
  );
  assert.equal(
    outcome.text,
    "> ```\n> code\n> ```\n- ```\n- [x](../../other-plan/plan.md)\n- ```\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("a paragraph, heading, then indented code protects the link", () => {
  const input = "Foo\n# H\n    [x](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("indented code right after a fenced block stays protected", () => {
  const input = "Foo\n\n```\ncode\n```\n    [x](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("definitions after setext headings are recognized", () => {
  const outcome = rewrite("Heading\n=======\n[id]: ../other-plan/plan.md\n");
  assert.equal(
    outcome.text,
    "Heading\n=======\n[id]: ../../other-plan/plan.md\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("lazy quote/list continuations never become definitions", () => {
  for (const input of [
    "> quote\n[id]: ../other-plan/plan.md\n",
    "- item\n[id]: ../other-plan/plan.md\n",
  ]) {
    const outcome = rewrite(input);
    assert.equal(outcome.text, input);
    assert.equal(outcome.rewritten, 0);
  }
});

test("definition titles holding link text stay byte-identical", () => {
  const input = '[id]: notes.md "[x](../other-plan/plan.md)"\n';
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a destination matching the label splices only the destination", () => {
  const outcome = rewrite("[../other-plan/plan.md]: ../other-plan/plan.md\n");
  assert.equal(
    outcome.text,
    "[../other-plan/plan.md]: ../../other-plan/plan.md\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("a definition after an inline-code-ended paragraph stays text", () => {
  const input = "Foo `code`\n[id]: ../other-plan/plan.md\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("CRLF documents rewrite with original bytes preserved", () => {
  const fence = rewrite("```\r\ncode\r\n```\r\n[x](../other-plan/plan.md)\r\n");
  assert.equal(
    fence.text,
    "```\r\ncode\r\n```\r\n[x](../../other-plan/plan.md)\r\n",
  );
  assert.equal(fence.rewritten, 1);
  const definition = rewrite("[id]: ../other-plan/plan.md\r\n");
  assert.equal(definition.text, "[id]: ../../other-plan/plan.md\r\n");
  assert.equal(definition.rewritten, 1);
  const multiline = rewrite('[x](../other-plan/plan.md\r\n "Title")\r\n');
  assert.equal(multiline.text, '[x](../../other-plan/plan.md\r\n "Title")\r\n');
  assert.equal(multiline.rewritten, 1);
});

test("an inline link before a definition rewrites both exactly once", () => {
  const outcome = rewrite(
    "[x](../other-plan/plan.md)\n\n[id]: ../other-plan/plan.md\n",
  );
  assert.equal(
    outcome.text,
    "[x](../../other-plan/plan.md)\n\n[id]: ../../other-plan/plan.md\n",
  );
  assert.equal(outcome.rewritten, 2);
});

test("a complete definition never consumes the next line", () => {
  const outcome = rewrite(
    "[id]: ../other-plan/plan.md\n  [x](../other-plan/plan.md)\n",
  );
  assert.equal(
    outcome.text,
    "[id]: ../../other-plan/plan.md\n  [x](../../other-plan/plan.md)\n",
  );
  assert.equal(outcome.rewritten, 2);
});

test("definitions in containers and indented forms are recognized", () => {
  for (const [input, want] of [
    ["- [id]: ../other-plan/plan.md\n", "- [id]: ../../other-plan/plan.md\n"],
    ["> [id]: ../other-plan/plan.md\n", "> [id]: ../../other-plan/plan.md\n"],
    [
      "> - [id]: ../other-plan/plan.md\n",
      "> - [id]: ../../other-plan/plan.md\n",
    ],
    ["  [id]: ../other-plan/plan.md\n", "  [id]: ../../other-plan/plan.md\n"],
  ] as const) {
    const outcome = rewrite(input);
    assert.equal(outcome.text, want);
    assert.equal(outcome.rewritten, 1);
  }
});

test("a title on the line after a definition stays definition-owned", () => {
  const input =
    '[id]: ../other-plan/plan.md\n  "Title [x](../other-plan/plan.md)"\n';
  const outcome = rewrite(input);
  assert.equal(
    outcome.text,
    '[id]: ../../other-plan/plan.md\n  "Title [x](../other-plan/plan.md)"\n',
  );
  assert.equal(outcome.rewritten, 1);
});

test("an unmatched short run before a valid long run protects the link", () => {
  const input = "` literal `` [x](../other-plan/plan.md) ``\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("labels span soft breaks but never blank lines", () => {
  const multi = rewrite("[a\nb\nc](../other-plan/plan.md)");
  assert.equal(multi.text, "[a\nb\nc](../../other-plan/plan.md)");
  assert.equal(multi.rewritten, 1);
  const blank = "[a\n\nb](../other-plan/plan.md)\n";
  const blankOutcome = rewrite(blank);
  assert.equal(blankOutcome.text, blank);
  assert.equal(blankOutcome.rewritten, 0);
});

test("titles span nonblank lines but never blank lines", () => {
  const multi = rewrite('[x](../other-plan/plan.md "a\nb\nc")');
  assert.equal(multi.text, '[x](../../other-plan/plan.md "a\nb\nc")');
  assert.equal(multi.rewritten, 1);
  const blank = '[x](../other-plan/plan.md "a\n\nc")';
  const blankOutcome = rewrite(blank);
  assert.equal(blankOutcome.text, blank);
  assert.equal(blankOutcome.rewritten, 0);
});

test("an angled destination with a newline stays byte-identical", () => {
  const input = "[x](<../other-plan/plan.md\n>)";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a multi-line definition label is recognized", () => {
  const outcome = rewrite("[a\nb]: ../other-plan/plan.md\n");
  assert.equal(outcome.text, "[a\nb]: ../../other-plan/plan.md\n");
  assert.equal(outcome.rewritten, 1);
  const blank = "[a\n\nb]: ../other-plan/plan.md\n";
  const blankOutcome = rewrite(blank);
  assert.equal(blankOutcome.text, blank);
  assert.equal(blankOutcome.rewritten, 0);
});

test("a link inside a mixed-length code span stays protected", () => {
  const input = "`` [x](../other-plan/plan.md) ` ``\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("an inner link voids its outer brackets", () => {
  const outcome = rewrite(
    "[outer [inner](../other-plan/plan.md)](../other-plan/plan.md)\n",
  );
  assert.equal(
    outcome.text,
    "[outer [inner](../../other-plan/plan.md)](../other-plan/plan.md)\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("a linked image rewrites both destinations", () => {
  const outcome = rewrite(
    "[![img](../other-plan/image.png)](../other-plan/plan.md)\n",
  );
  assert.equal(
    outcome.text,
    "[![img](../../other-plan/image.png)](../../other-plan/plan.md)\n",
  );
  assert.equal(outcome.rewritten, 2);
});

test("a title on the third line stays definition-owned", () => {
  const input =
    '[id]:\n  ../other-plan/plan.md\n  "Title [x](../other-plan/plan.md)"\n';
  const outcome = rewrite(input);
  assert.equal(
    outcome.text,
    '[id]:\n  ../../other-plan/plan.md\n  "Title [x](../other-plan/plan.md)"\n',
  );
  assert.equal(outcome.rewritten, 1);
});

test("a title spanning lines owns the whole definition", () => {
  for (const input of [
    '[id]:\n  ../other-plan/plan.md "Ti\ntle"\n',
    '[id]: ../other-plan/plan.md "Ti\ntle"\n',
  ]) {
    const outcome = rewrite(input);
    assert.ok(outcome.text.includes("../../other-plan/plan.md"));
    assert.ok(outcome.text.includes('"Ti\ntle"'));
    assert.equal(outcome.rewritten, 1);
  }
});

test("raw HTML blocks protect their literal links", () => {
  for (const input of [
    "<!--\n[x](../other-plan/plan.md)\n",
    "<script>\n[x](../other-plan/plan.md)\n</script>\n",
    "<div>\n[x](../other-plan/plan.md)\n</div>\n",
  ]) {
    const outcome = rewrite(input);
    assert.equal(outcome.text, input);
    assert.equal(outcome.rewritten, 0);
  }
  const after = rewrite(
    "<div>\n[x](../other-plan/plan.md)\n</div>\n\n[y](../other-plan/plan.md)\n",
  );
  assert.equal(
    after.text,
    "<div>\n[x](../other-plan/plan.md)\n</div>\n\n[y](../../other-plan/plan.md)\n",
  );
  assert.equal(after.rewritten, 1);
});

test("a backtick fence with a backtick info string is not a fence", () => {
  const outcome = rewrite("``` foo`bar`\n[x](../other-plan/plan.md)\n```\n");
  assert.equal(
    outcome.text,
    "``` foo`bar`\n[x](../../other-plan/plan.md)\n```\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("a quoted paragraph swallows definition-looking text", () => {
  const input = "> Foo\n> [id]: ../other-plan/plan.md\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("raw HTML ends with its quote container", () => {
  const outcome = rewrite("> <script>\n> x\n[x](../other-plan/plan.md)\n");
  assert.equal(
    outcome.text,
    "> <script>\n> x\n[x](../../other-plan/plan.md)\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("processing instructions, declarations, CDATA, and complete tags", () => {
  for (const input of [
    "<?pi\n[x](../other-plan/plan.md)\n?>\n",
    "<!A\n[x](../other-plan/plan.md)\n>\n",
    "<![CDATA[\n[x](../other-plan/plan.md)\n]]>\n",
    "<custom-tag>\n[x](../other-plan/plan.md)\n\n",
  ]) {
    const outcome = rewrite(input);
    assert.equal(outcome.text, input);
    assert.equal(outcome.rewritten, 0);
  }
  const after = rewrite(
    "<custom-tag>\n[x](../other-plan/plan.md)\n\n[y](../other-plan/plan.md)\n",
  );
  assert.equal(
    after.text,
    "<custom-tag>\n[x](../other-plan/plan.md)\n\n[y](../../other-plan/plan.md)\n",
  );
  assert.equal(after.rewritten, 1);
});

test("a lone closing tag opens a blank-terminated block", () => {
  const input = "> <script>\n> x\n</script>\n[x](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("lazy paragraph definitions never close the paragraph", () => {
  const input =
    "> Foo\n> [a]: ../other-plan/plan.md\n> [b]: ../other-plan/plan.md\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("an outer image survives a nested link", () => {
  const outcome = rewrite(
    "![outer [inner](../other-plan/plan.md)](../other-plan/image.png)\n",
  );
  assert.equal(
    outcome.text,
    "![outer [inner](../../other-plan/plan.md)](../../other-plan/image.png)\n",
  );
  assert.equal(outcome.rewritten, 2);
});

test("CRLF multi-line definitions keep original bytes", () => {
  const label = rewrite("[a\r\nb]: ../other-plan/plan.md\r\n");
  assert.equal(label.text, "[a\r\nb]: ../../other-plan/plan.md\r\n");
  assert.equal(label.rewritten, 1);
  const title = rewrite('[id]:\r\n  ../other-plan/plan.md "Ti\r\ntle"\r\n');
  assert.equal(
    title.text,
    '[id]:\r\n  ../../other-plan/plan.md "Ti\r\ntle"\r\n',
  );
  assert.equal(title.rewritten, 1);
});

test("a type-6 tag interrupts a paragraph", () => {
  const input = "Foo\n<div>\n[x](../other-plan/plan.md)\n</div>\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a same-line comment owns the whole line", () => {
  const input = "<!-- x --> [x](../other-plan/plan.md)\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("a nested image never voids its outer image", () => {
  const outcome = rewrite(
    "![outer ![inner](../other-plan/image.png)](../other-plan/image.png)\n",
  );
  assert.equal(
    outcome.text,
    "![outer ![inner](../../other-plan/image.png)](../../other-plan/image.png)\n",
  );
  assert.equal(outcome.rewritten, 2);
});

test("a multi-line title stays definition-owned", () => {
  const input =
    '[id]: ../other-plan/plan.md\n  "Title\n  [x](../other-plan/plan.md)\n  tail"\n';
  const outcome = rewrite(input);
  assert.equal(
    outcome.text,
    '[id]: ../../other-plan/plan.md\n  "Title\n  [x](../other-plan/plan.md)\n  tail"\n',
  );
  assert.equal(outcome.rewritten, 1);
});

test("a CRLF multi-line label keeps later offsets exact", () => {
  const input =
    "[a\r\nb]: ../other-plan/plan.md\r\n[id2]: ../other-plan/plan.md\r\n";
  const outcome = rewrite(input);
  assert.equal(
    outcome.text,
    "[a\r\nb]: ../../other-plan/plan.md\r\n[id2]: ../../other-plan/plan.md\r\n",
  );
  assert.equal(outcome.rewritten, 2);
});

test("next-line destinations need no indentation, even quoted", () => {
  for (const [input, want] of [
    ["[id]:\n../other-plan/plan.md\n", "[id]:\n../../other-plan/plan.md\n"],
    [
      "> [id]:\n> ../other-plan/plan.md\n",
      "> [id]:\n> ../../other-plan/plan.md\n",
    ],
  ] as const) {
    const outcome = rewrite(input);
    assert.equal(outcome.text, want);
    assert.equal(outcome.rewritten, 1);
  }
});

test("an unbalanced destination is not a definition", () => {
  const input = "[id]: ../other-plan/foo).md\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("partially marked nested quotes stay lazy", () => {
  const input = "> > > foo\n> [id]: ../other-plan/plan.md\n";
  const outcome = rewrite(input);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("an ordered marker must start at 1 to interrupt", () => {
  const lazy = "foo\n2. [id]: ../other-plan/plan.md\n";
  const lazyOutcome = rewrite(lazy);
  assert.equal(lazyOutcome.text, lazy);
  assert.equal(lazyOutcome.rewritten, 0);
  const interrupting = "foo\n1. [id]: ../other-plan/plan.md\n";
  const interruptingOutcome = rewrite(interrupting);
  assert.equal(
    interruptingOutcome.text,
    "foo\n1. [id]: ../../other-plan/plan.md\n",
  );
  assert.equal(interruptingOutcome.rewritten, 1);
});

test("resolveLinkPath is POSIX-only and reports root escapes", () => {
  assert.equal(
    resolveLinkPath("plans/a", "../other/plan.md"),
    "plans/other/plan.md",
  );
  assert.equal(resolveLinkPath("plans/a", "..\\x"), "plans/a/..\\x");
  assert.equal(resolveLinkPath("plans/a", "../../.."), null);
});

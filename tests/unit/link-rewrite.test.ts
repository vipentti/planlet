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
    absolutePath.endsWith("plans/other-plan/foo(bar).md") ||
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

test("resolveLinkPath is POSIX-only and reports root escapes", () => {
  assert.equal(
    resolveLinkPath("plans/a", "../other/plan.md"),
    "plans/other/plan.md",
  );
  assert.equal(resolveLinkPath("plans/a", "..\\x"), "plans/a/..\\x");
  assert.equal(resolveLinkPath("plans/a", "../../.."), null);
});

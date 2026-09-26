import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveLinkPath,
  rewriteOutgoingLinks,
} from "../../src/core/plan/link-rewrite.js";

const PLAN_DIR = "plans/link-plan";

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
    const outcome = rewriteOutgoingLinks(input, PLAN_DIR);
    assert.equal(outcome.text, input);
    assert.equal(outcome.rewritten, 0);
  }
});

test("escaping links gain exactly one parent level", () => {
  const outcome = rewriteOutgoingLinks(
    '[cross](../other-plan/plan.md) and [titled](../other-plan/plan.md "Title")',
    PLAN_DIR,
  );
  assert.equal(
    outcome.text,
    '[cross](../../other-plan/plan.md) and [titled](../../other-plan/plan.md "Title")',
  );
  assert.equal(outcome.rewritten, 2);
});

test("reference definitions are rewritten while usages stay intact", () => {
  const outcome = rewriteOutgoingLinks(
    "See [ref][target].\n\n[target]: ../other-plan/plan.md\n",
    PLAN_DIR,
  );
  assert.equal(
    outcome.text,
    "See [ref][target].\n\n[target]: ../../other-plan/plan.md\n",
  );
  assert.equal(outcome.rewritten, 1);
});

test("code spans, code blocks, and comments are never rewritten", () => {
  const input =
    "```\n[x](../other-plan/plan.md)\n```\n\n" +
    "    [indented](../other-plan/plan.md)\n\n" +
    "`[inline](../other-plan/plan.md)` and <!-- [comment](../other-plan/plan.md) -->\n\n" +
    "[real](../other-plan/plan.md)\n";
  const outcome = rewriteOutgoingLinks(input, PLAN_DIR);
  assert.equal(outcome.rewritten, 1);
  assert.ok(outcome.text.includes("[real](../../other-plan/plan.md)"));
  assert.ok(outcome.text.includes("```\n[x](../other-plan/plan.md)\n```"));
  assert.ok(outcome.text.includes("`[inline](../other-plan/plan.md)`"));
});

test("URL-encoded paths and fragments survive the prefix edit", () => {
  const outcome = rewriteOutgoingLinks(
    "[docs](../my%20docs/x.md#section)",
    PLAN_DIR,
  );
  assert.equal(outcome.text, "[docs](../../my%20docs/x.md#section)");
  assert.equal(outcome.rewritten, 1);
});

test("backslashes are literal characters, never separators", () => {
  const input = "[win](notes\\copy.md)";
  const outcome = rewriteOutgoingLinks(input, PLAN_DIR);
  assert.equal(outcome.text, input);
  assert.equal(outcome.rewritten, 0);
});

test("above-root escapes are skipped with a note", () => {
  const outcome = rewriteOutgoingLinks("[o](../../../../etc/x)", PLAN_DIR);
  assert.equal(outcome.text, "[o](../../../../etc/x)");
  assert.equal(outcome.rewritten, 0);
  assert.equal(outcome.skipped.length, 1);
});

test("rewriting is idempotent", () => {
  const once = rewriteOutgoingLinks("[x](../other-plan/plan.md)", PLAN_DIR);
  const twice = rewriteOutgoingLinks(once.text, PLAN_DIR);
  assert.equal(twice.rewritten, 0);
  assert.equal(twice.text, once.text);
});

test("resolveLinkPath is POSIX-only and reports root escapes", () => {
  assert.equal(
    resolveLinkPath("plans/a", "../other/plan.md"),
    "plans/other/plan.md",
  );
  assert.equal(resolveLinkPath("plans/a", "..\\x"), "plans/a/..\\x");
  assert.equal(resolveLinkPath("plans/a", "../../.."), null);
});

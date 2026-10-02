import assert from "node:assert/strict";
import test from "node:test";

import {
  rewriteArchiveLinks,
  rewritePlanletDepthLinks,
  type LinkRewriteResult,
} from "../../src/core/plan/link-rewrite.js";

const PLAN_DIR = "plans/demo";
const ARCHIVE_DIR = "plans/completed/2026-09-26-demo";

function rewrite(
  text: string,
  {
    exists = () => true,
    fileName = "plan.md",
  }: {
    readonly exists?: (path: string) => boolean;
    readonly fileName?: string;
  } = {},
): LinkRewriteResult {
  return rewriteArchiveLinks({
    fileName,
    planDir: PLAN_DIR,
    archiveDir: ARCHIVE_DIR,
    exists,
    text,
  });
}

const one = (path: string) => (target: string) => target === path;

test("rewrites a link in a nested list and in a block quote inside a list item", () => {
  const text =
    "- item\n" +
    "  - inner\n" +
    "\n" +
    "    > [q](../other/plan.md)\n" +
    "\n" +
    "- [l](../other/plan.md)\n";
  const result = rewrite(text, {
    exists: one("plans/other/plan.md"),
  });

  assert.equal(
    result.text,
    "- item\n" +
      "  - inner\n" +
      "\n" +
      "    > [q](../../other/plan.md)\n" +
      "\n" +
      "- [l](../../other/plan.md)\n",
  );
  assert.equal(result.rewrites, 2);
  assert.deepEqual(result.notes, []);
});

test("leaves code spans, fenced blocks, and indented code unchanged", () => {
  const text =
    "`[a](../x.md)` and ``[b](../x.md) ` ` ``\n" +
    "\n" +
    "```\n[c](../x.md)\n```\n" +
    "\n" +
    "~~~\n[d](../x.md)\n~~~\n" +
    "\n" +
    "- item\n" +
    "\n" +
    "  ```\n  [e](../x.md)\n  ```\n" +
    "\n" +
    "> ```\n> [f](../x.md)\n> ```\n" +
    "\n" +
    "    [g](../x.md)\n";
  const result = rewrite(text, { exists: () => true });

  assert.equal(result.text, text);
  assert.equal(result.rewrites, 0);
  assert.deepEqual(result.notes, []);
});

test("rewrites a lazy paragraph line indented four spaces", () => {
  const text = "Text\n    continuation [a](../x.md)\n";
  const result = rewrite(text, { exists: one("plans/x.md") });

  assert.equal(result.text, "Text\n    continuation [a](../../x.md)\n");
  assert.equal(result.rewrites, 1);
});

test("rewrites a reference definition once for full, collapsed, and shortcut uses", () => {
  const text = "[full][d] [collapsed][] [shortcut]\n\n[d]: ../x.md\n";
  const result = rewrite(text, { exists: one("plans/x.md") });

  assert.equal(
    result.text,
    "[full][d] [collapsed][] [shortcut]\n\n[d]: ../../x.md\n",
  );
  assert.equal(result.rewrites, 1);
});

test("rewrites a definition with the destination on the next line and a multi-line title", () => {
  const text = '[d]:\n  ../x.md\n  "multi\n  line"\n';
  const result = rewrite(text, { exists: one("plans/x.md") });

  assert.equal(result.text, '[d]:\n  ../../x.md\n  "multi\n  line"\n');
  assert.equal(result.rewrites, 1);
});

test("rewrites only the definition destination when the title holds a link", () => {
  const text = '[d]: ../x.md "title [b](../x.md)"\n';
  const result = rewrite(text, { exists: one("plans/x.md") });

  assert.equal(result.text, '[d]: ../../x.md "title [b](../x.md)"\n');
  assert.equal(result.rewrites, 1);
});

test("leaves a lazy definition line after paragraph text unchanged", () => {
  const text = "text [a]: ../x.md\n";
  const result = rewrite(text, { exists: () => true });

  assert.equal(result.text, text);
  assert.equal(result.rewrites, 0);
  assert.deepEqual(result.notes, []);
});

test("leaves a GFM footnote definition unchanged", () => {
  const text = "[^1]: ../x.md\n";
  const result = rewrite(text, { exists: () => true });

  assert.equal(result.text, text);
  assert.equal(result.rewrites, 0);
  assert.deepEqual(result.notes, []);
});

test("rewrites escaped and balanced destinations without touching the escapes", () => {
  const text =
    "[a](../x\\).md) [b](../x\\#y.md) [c](../p(q).md) [d](../back\\slash.md)\n";
  const result = rewrite(text, {
    exists: (target) =>
      target === "plans/x).md" || target === "plans/back\\slash.md",
  });

  assert.equal(
    result.text,
    "[a](../../x\\).md) [b](../x\\#y.md) [c](../p(q).md) [d](../../back\\slash.md)\n",
  );
  assert.equal(result.rewrites, 2);
  assert.deepEqual(result.notes, [
    // The escape keeps the backslash out of the parsed destination, but the
    // resulting `#` still separates the path from the fragment at the URL
    // layer, exactly as a browser would resolve it.
    "plan.md link left unchanged (unresolved target: ../x\\#y.md)",
    "plan.md link left unchanged (unresolved target: ../p(q).md)",
  ]);
});

test("classifies entity-encoded destinations and preserves their bytes", () => {
  const text = "[a](../a&amp;b.md) [b](../&bogus;.md) [c](../x&#35;c.md)\n";
  const result = rewrite(text, {
    exists: (target) =>
      target === "plans/a&b.md" ||
      target === "plans/&bogus;.md" ||
      target === "plans/x",
  });

  assert.equal(
    result.text,
    "[a](../../a&amp;b.md) [b](../../&bogus;.md) [c](../../x&#35;c.md)\n",
  );
  assert.equal(result.rewrites, 3);
  assert.deepEqual(result.notes, []);
});

test("rewrites an angle-bracket destination containing a space", () => {
  const text = '[c](<../sp ace.md> "title (with parens)")\n';
  const result = rewrite(text, { exists: one("plans/sp ace.md") });

  assert.equal(result.text, '[c](<../../sp ace.md> "title (with parens)")\n');
  assert.equal(result.rewrites, 1);
  assert.deepEqual(result.notes, []);
});

test("rewrites a destination whose title follows on the next line", () => {
  const text = '[a](\n  ../x.md\n  "title"\n)\n';
  const result = rewrite(text, { exists: one("plans/x.md") });

  assert.equal(result.text, '[a](\n  ../../x.md\n  "title"\n)\n');
  assert.equal(result.rewrites, 1);
});

test("preserves CRLF line endings", () => {
  const text = '[a](../x.md)\r\n\r\n[d]: ../y.md\r\n  "t"\r\n';
  const result = rewrite(text, {
    exists: (target) => target === "plans/x.md" || target === "plans/y.md",
  });

  assert.equal(
    result.text,
    '[a](../../x.md)\r\n\r\n[d]: ../../y.md\r\n  "t"\r\n',
  );
  assert.equal(result.rewrites, 2);
});

test("preserves bare CR line endings and adds no LF", () => {
  const text = '[a](../x.md)\r\r[d]:\r  ../y.md\r  "t"\r';
  const result = rewrite(text, {
    exists: (target) => target === "plans/x.md" || target === "plans/y.md",
  });

  assert.equal(result.text, '[a](../../x.md)\r\r[d]:\r  ../../y.md\r  "t"\r');
  assert.equal(result.rewrites, 2);
  assert.ok(!result.text.includes("\n"));
});

test("rewrites images and images inside links", () => {
  const text = "![i](../i.png) [![in](../i.png)](../l.md)\n";
  const result = rewrite(text, {
    exists: (target) => target === "plans/i.png" || target === "plans/l.md",
  });

  assert.equal(
    result.text,
    "![i](../../i.png) [![in](../../i.png)](../../l.md)\n",
  );
  assert.equal(result.rewrites, 3);
});

test("rewrites only the inner destination of nested bracket links", () => {
  const text = "[outer [inner](../a)](b)\n";
  const result = rewrite(text, { exists: one("plans/a") });

  assert.equal(result.text, "[outer [inner](../../a)](b)\n");
  assert.equal(result.rewrites, 1);
  assert.deepEqual(result.notes, []);
});

test("leaves HTML blocks and comments unchanged", () => {
  const text =
    "<div>\n[a](../x.md)\n</div>\n\n<!-- [b](../x.md) -->\n\n<p>[c](../x.md)</p>\n";
  const result = rewrite(text, { exists: () => true });

  assert.equal(result.text, text);
  assert.equal(result.rewrites, 0);
  assert.deepEqual(result.notes, []);
});

test("uses correct offsets after non-ASCII text", () => {
  const text = "é中文 🎉 [a](../x.md) trailing\n";
  const result = rewrite(text, { exists: one("plans/x.md") });

  assert.equal(result.text, "é中文 🎉 [a](../../x.md) trailing\n");
  assert.equal(result.rewrites, 1);
});

test("rewrites a link inside a GFM table cell", () => {
  const text = "| h | t |\n| --- | --- |\n| [c](../x.md) | y |\n";
  const result = rewrite(text, { exists: one("plans/x.md") });

  assert.equal(
    result.text,
    "| h | t |\n| --- | --- |\n| [c](../../x.md) | y |\n",
  );
  assert.equal(result.rewrites, 1);
});

test("leaves sibling, subdirectory, anchor, scheme, and absolute targets alone", () => {
  const text =
    "[a](tasks.md) [b](docs/design.md) [c](#anchor) [d](https://example.com/x.md) " +
    "[e](/root.md) [f]() [g](?q=1)\n";
  const result = rewrite(text, { exists: () => true });

  assert.equal(result.text, text);
  assert.equal(result.rewrites, 0);
  assert.deepEqual(result.notes, []);
});

test("rewrites repository targets one and two levels up and keeps a fragment", () => {
  const text =
    "[a](../other/plan.md) [b](../../src/x.ts) [c](../other/plan.md#section)\n";
  const result = rewrite(text, {
    exists: (target) =>
      target === "plans/other/plan.md" || target === "src/x.ts",
  });

  assert.equal(
    result.text,
    "[a](../../other/plan.md) [b](../../../src/x.ts) [c](../../other/plan.md#section)\n",
  );
  assert.equal(result.rewrites, 3);
  assert.deepEqual(result.notes, []);
});

test("leaves an already written archive-depth link unchanged without a note", () => {
  const result = rewrite("[a](../../../src/x.ts)\n", {
    exists: one("src/x.ts"),
  });

  assert.equal(result.text, "[a](../../../src/x.ts)\n");
  assert.equal(result.rewrites, 0);
  assert.deepEqual(result.notes, []);
});

test("rewrites a link to an archived planlet and keeps its fragment", () => {
  const result = rewrite("[a](../completed/2026-01-02-old/plan.md#s)\n", {
    exists: one("plans/completed/2026-01-02-old/plan.md"),
  });

  assert.equal(result.text, "[a](../../completed/2026-01-02-old/plan.md#s)\n");
  assert.equal(result.rewrites, 1);
  assert.deepEqual(result.notes, []);
});

test("leaves a path that resolves to the planlet directory itself unchanged", () => {
  for (const path of [".", "./", "docs/..", "a/b/../.."]) {
    const result = rewrite(`[a](${path})\n`, { exists: one("plans/demo") });

    assert.equal(result.text, `[a](${path})\n`);
    assert.equal(result.rewrites, 0);
    assert.deepEqual(result.notes, []);
  }
});

test("notes a path that names the planlet directory through its parent", () => {
  for (const path of ["../demo", "../demo/"]) {
    const result = rewrite(`[a](${path})\n`, { exists: one("plans/demo") });

    assert.equal(result.text, `[a](${path})\n`);
    assert.deepEqual(result.notes, [
      `plan.md link left unchanged (reaches planlet through its parent directory: ${path})`,
    ]);
  }
});

test("notes a missing target at both depths and a target above the repository root", () => {
  const result = rewrite("[a](../missing.md) [b](../../../../outside.md)\n", {
    exists: () => false,
    fileName: "tasks.md",
  });

  assert.equal(result.text, "[a](../missing.md) [b](../../../../outside.md)\n");
  assert.deepEqual(result.notes, [
    "tasks.md link left unchanged (unresolved target: ../missing.md)",
    "tasks.md link left unchanged (unresolved target: ../../../../outside.md)",
  ]);
});

test("notes a target that exists at both depths as ambiguous", () => {
  const result = rewrite("[a](../sibling.md)\n", { exists: () => true });

  assert.equal(result.text, "[a](../sibling.md)\n");
  assert.deepEqual(result.notes, [
    "plan.md link left unchanged (ambiguous target: ../sibling.md)",
  ]);
});

test("notes a link that reaches the planlet through its parent directory", () => {
  const result = rewrite("[a](../demo/tasks.md)\n", { exists: () => true });

  assert.equal(result.text, "[a](../demo/tasks.md)\n");
  assert.deepEqual(result.notes, [
    "plan.md link left unchanged (reaches planlet through its parent directory: ../demo/tasks.md)",
  ]);
});

test("notes malformed percent-encoding and NUL without probing the filesystem", () => {
  let probes = 0;
  const result = rewrite("[a](../bad%zz.md) [b](../nul%00.md)\n", {
    exists: () => {
      probes += 1;
      return true;
    },
  });

  assert.equal(result.text, "[a](../bad%zz.md) [b](../nul%00.md)\n");
  assert.equal(probes, 0);
  assert.deepEqual(result.notes, [
    "plan.md link left unchanged (invalid path: ../bad%zz.md)",
    "plan.md link left unchanged (invalid path: ../nul%00.md)",
  ]);
});

test("notes an invalid path when the existence probe throws", () => {
  const result = rewrite("[a](../x.md)\n", {
    exists: (target) => {
      if (target === "plans/x.md") throw new Error("ENAMETOOLONG");
      return false;
    },
  });

  assert.equal(result.text, "[a](../x.md)\n");
  assert.deepEqual(result.notes, [
    "plan.md link left unchanged (invalid path: ../x.md)",
  ]);
});

test("a second pass over rewritten output changes nothing", () => {
  const text =
    "[a](../other/plan.md) [b](../../src/x.ts) [c](../demo/tasks.md) [d](./) " +
    "[e](<../other/plan.md#s>) [f](https://example.com)\n";
  const exists = (target: string) =>
    target === "plans/other/plan.md" || target === "src/x.ts";
  const first = rewrite(text, { exists });
  const second = rewrite(first.text, { exists });

  assert.equal(first.rewrites, 3);
  assert.equal(second.text, first.text);
  assert.equal(second.rewrites, 0);
  assert.deepEqual(second.notes, first.notes);
});

test("rewritePlanletDepthLinks prepends one ../ per extra plansDir segment", () => {
  const text = "See [design](../../README.md).\n";
  const one = rewritePlanletDepthLinks({
    fileName: "plan.md",
    planDir: "plans/foo",
    fromPrefix: "plans",
    toPrefix: "docs/plans",
    text,
  });
  assert.equal(one.text, "See [design](../../../README.md).\n");
  assert.equal(one.rewrites, 1);
  const two = rewritePlanletDepthLinks({
    fileName: "plan.md",
    planDir: "plans/foo",
    fromPrefix: "plans",
    toPrefix: "docs/team/plans",
    text,
  });
  assert.equal(two.text, "See [design](../../../../README.md).\n");
  assert.equal(two.rewrites, 1);
  const shallower = rewritePlanletDepthLinks({
    fileName: "plan.md",
    planDir: "docs/team/plans/foo",
    fromPrefix: "docs/team/plans",
    toPrefix: "docs/plans",
    text: two.text,
  });
  assert.equal(shallower.text, "See [design](../../../README.md).\n");
  assert.equal(shallower.rewrites, 1);
});

test("rewritePlanletDepthLinks leaves sibling planlet links unchanged", () => {
  const text =
    "See [sib](../other-plan/plan.md) and [root](../../README.md).\n";
  const result = rewritePlanletDepthLinks({
    fileName: "plan.md",
    planDir: "plans/foo",
    fromPrefix: "plans",
    toPrefix: "docs/plans",
    text,
  });
  assert.equal(
    result.text,
    "See [sib](../other-plan/plan.md) and [root](../../../README.md).\n",
  );
  assert.equal(result.rewrites, 1);
  const shallower = rewritePlanletDepthLinks({
    fileName: "plan.md",
    planDir: "docs/plans/foo",
    fromPrefix: "docs/plans",
    toPrefix: "plans",
    text: result.text,
  });
  assert.equal(
    shallower.text,
    "See [sib](../other-plan/plan.md) and [root](../../README.md).\n",
  );
  assert.equal(shallower.rewrites, 1);
});

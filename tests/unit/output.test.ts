import assert from "node:assert/strict";
import test from "node:test";

import { decode, encode } from "@toon-format/toon";

import { ERROR_CODES, ERROR_EXIT_CODES } from "../../src/errors/codes.js";
import { PlanletError } from "../../src/errors/planlet-error.js";
import { renderToon, renderToonError } from "../../src/output/toon.js";

test("renders successful structured data with the official TOON encoder", () => {
  const data = {
    plans: [
      {
        slug: "cli-core",
        state: "in_progress",
        done: 9,
        total: 14,
      },
    ],
  };

  const rendered = renderToon(data);

  assert.equal(rendered.stdout, `${encode(data)}\n`);
  assert.equal(rendered.stderr, "");
  assert.equal(rendered.exitCode, 0);
});

test("surfaces warnings as diagnostics on stderr without mixing them into data", () => {
  const rendered = renderToon({ slug: "cli-core", state: "in_progress" }, [
    "Missing recommended Verification section",
  ]);

  assert.deepEqual(decode(rendered.stdout.trimEnd()), {
    slug: "cli-core",
    state: "in_progress",
  });
  assert.deepEqual(decode(rendered.stderr.trimEnd()), {
    diagnostics: [
      {
        level: "warning",
        message: "Missing recommended Verification section",
      },
    ],
  });
  assert.doesNotMatch(rendered.stdout, /Missing recommended/);
  assert.equal(rendered.exitCode, 0);
});

test("truncates large strings with a size hint unless --full is active", () => {
  const content = "0123456789🙂abcdef";
  const result = { slug: "cli-core", content };

  const compact = renderToon(result, [], { maxStringCharacters: 10 });
  assert.deepEqual(decode(compact.stdout.trimEnd()), {
    slug: "cli-core",
    content: {
      preview: "0123456789…",
      truncated: true,
      originalCharacters: 17,
      shownCharacters: 10,
      hint: "Re-run with --full for complete content",
    },
  });

  const full = renderToon(result, [], {
    full: true,
    maxStringCharacters: 10,
  });
  assert.deepEqual(decode(full.stdout.trimEnd()), {
    slug: "cli-core",
    content,
  });
});

test("renders every stable error on stderr with its mapped exit code", () => {
  for (const code of ERROR_CODES) {
    const error = new PlanletError(code, `Failure: ${code}`, {
      details: { slug: "cli-core" },
      next: "Inspect the planlet",
    });
    const rendered = renderToonError(error.toStructuredError());

    assert.equal(rendered.stdout, "", code);
    assert.equal(rendered.exitCode, ERROR_EXIT_CODES[code], code);
    assert.deepEqual(decode(rendered.stderr.trimEnd()), {
      error: {
        code,
        message: `Failure: ${code}`,
        slug: "cli-core",
      },
      next: "Inspect the planlet",
    });
  }
});

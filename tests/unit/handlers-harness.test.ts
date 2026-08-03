import assert from "node:assert/strict";
import test from "node:test";

import { decode } from "@toon-format/toon";

import { harnessInstallOutcome } from "../../src/commands/handlers.js";
import type { InstallationSummary } from "../../src/core/harness-installer.js";
import { renderToon } from "../../src/output/toon.js";

test("harness install outcome routes destination warnings to diagnostics only", () => {
  const result: InstallationSummary = {
    operation: "update",
    changed: true,
    plansInitialized: false,
    destinations: [
      {
        destination: ".agents/skills",
        tools: ["agents"],
        state: "installed",
        changed: true,
        files: 2,
        warnings: [
          "Harness installation published but cleanup was incomplete at /tmp/skills",
        ],
      },
    ],
  };

  const outcome = harnessInstallOutcome(result);
  assert.deepEqual(outcome.warnings, [
    "Harness installation published but cleanup was incomplete at /tmp/skills",
  ]);
  assert.equal("warnings" in (outcome.data.destinations[0] as object), false);
  assert.equal("warnings" in outcome.data, false);

  const rendered = renderToon(outcome.data, outcome.warnings);
  assert.equal(rendered.exitCode, 0);
  assert.doesNotMatch(rendered.stdout, /cleanup was incomplete/);
  assert.match(rendered.stderr, /cleanup was incomplete/);
  assert.deepEqual(decode(rendered.stderr.trimEnd()), {
    diagnostics: [
      {
        level: "warning",
        message:
          "Harness installation published but cleanup was incomplete at /tmp/skills",
      },
    ],
  });
});

test("harness install outcome routes repository-wide warnings to diagnostics only", () => {
  const outcome = harnessInstallOutcome({
    operation: "update",
    changed: true,
    plansInitialized: false,
    destinations: [
      {
        destination: ".agents/skills",
        tools: ["agents"],
        state: "installed",
        changed: true,
        files: 2,
      },
    ],
    warnings: ["Lock release failed at /tmp/planlet-locks/__harness__"],
  });

  assert.deepEqual(outcome.warnings, [
    "Lock release failed at /tmp/planlet-locks/__harness__",
  ]);
  assert.equal("warnings" in outcome.data, false);

  const rendered = renderToon(outcome.data, outcome.warnings);
  assert.doesNotMatch(rendered.stdout, /Lock release failed/);
  assert.match(rendered.stderr, /Lock release failed/);
});

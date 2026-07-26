import assert from "node:assert/strict";
import test from "node:test";

import { PLANLET_STATES } from "../../src/core/models.js";

test("the lifecycle state model exposes the designed stable values", () => {
  assert.deepEqual(PLANLET_STATES, [
    "invalid",
    "draft",
    "planned",
    "in_progress",
    "ready_to_complete",
    "completed",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { PlanletTask } from "../../src/core/models.js";
import { deriveLifecycleState } from "../../src/core/status.js";

const task = (id: `T${number}`, completed: boolean): PlanletTask => ({
  id,
  description: id,
  completed,
});

test("active lifecycle states derive from recognized task progress", () => {
  assert.equal(
    deriveLifecycleState({ valid: true, location: "active", tasks: [] }),
    "draft",
  );
  assert.equal(
    deriveLifecycleState({
      valid: true,
      location: "active",
      tasks: [task("T1", false), task("T2", false)],
    }),
    "planned",
  );
  assert.equal(
    deriveLifecycleState({
      valid: true,
      location: "active",
      tasks: [task("T1", true), task("T2", false)],
    }),
    "in_progress",
  );
  assert.equal(
    deriveLifecycleState({
      valid: true,
      location: "active",
      tasks: [task("T1", true), task("T2", true)],
    }),
    "ready_to_complete",
  );
});

test("invalid structure wins over location and completed location wins over progress", () => {
  assert.equal(
    deriveLifecycleState({ valid: false, location: "completed", tasks: [] }),
    "invalid",
  );
  assert.equal(
    deriveLifecycleState({ valid: true, location: "completed", tasks: [] }),
    "completed",
  );
});

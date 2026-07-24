import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../src/cli.js";

test("the CLI scaffold exits successfully", () => {
  assert.equal(main(), 0);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../../src/cli.js";

test("help exits successfully without using process I/O or repository state", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    main(["help"], {
      cwd: "/path/that/does/not/need/to/exist",
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    }),
    0,
  );
  assert.match(stdout.join(""), /^Usage: planlet/);
  assert.equal(stderr.join(""), "");
});
test("the README command table lists exactly the commands help does", () => {
  const stdout: string[] = [];
  main(["help"], {
    cwd: "/path/that/does/not/need/to/exist",
    stdout: (value) => stdout.push(value),
    stderr: () => {},
  });
  const help = stdout
    .join("")
    .split(/^Commands:\n/m)[1]!
    .split("\n\n")[0]!
    .split("\n")
    .map((line) => line.trim());

  const readme = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "README.md"),
    "utf8",
  );
  const section = readme.split(/^## Commands\n/m)[1]!.split(/^## /m)[0]!;
  const documented = [...section.matchAll(/^\| `(.+?)` +\|/gm)].map((match) =>
    match[1]!.replaceAll("\\|", "|"),
  );

  assert.deepEqual(documented, help);
});

test("installation command help documents selectors and force flags", () => {
  for (const [command, pattern] of [
    ["init", /init \[--tools <ids>\] \[--force\]/],
    ["update", /update \[--tools <ids>\] \[--force\]/],
    ["tools", /planlet tools/],
  ] as const) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    assert.equal(
      main(["help", command], {
        cwd: "/path/that/does/not/need/to/exist",
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      }),
      0,
    );
    assert.match(stdout.join(""), pattern);
    assert.equal(stderr.join(""), "");
  }
});

test("invalid commands and arguments fail with usage before repository discovery", () => {
  for (const arguments_ of [["status"], ["bogus"], ["list", "--bogus"]]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    assert.equal(
      main(arguments_, {
        cwd: "/path/that/does/not/need/to/exist",
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      }),
      2,
    );
    assert.equal(stdout.join(""), "");
    assert.match(stderr.join(""), /^usage:/);
    assert.doesNotMatch(stderr.join(""), /repo_not_found/);
  }
});

test("unexpected TypeErrors from output sinks propagate", () => {
  const failure = new TypeError("broken output sink");

  assert.throws(
    () =>
      main(["help"], {
        cwd: "/path/that/does/not/need/to/exist",
        stdout: () => {
          throw failure;
        },
        stderr: () => undefined,
      }),
    (error) => error === failure,
  );
});

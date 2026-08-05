import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../../src/cli.js";
import { renderAgentSnippet } from "../../src/core/agent-snippet.js";

test("help exits successfully without using process I/O or repository state", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await main(["help"], {
      cwd: "/path/that/does/not/need/to/exist",
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    }),
    0,
  );
  assert.match(stdout.join(""), /^Usage: planlet/);
  assert.equal(stderr.join(""), "");
});
test("the README command table lists exactly the commands help does", async () => {
  const stdout: string[] = [];
  await main(["help"], {
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

test("installation command help documents selectors and force flags", async () => {
  for (const [command, pattern] of [
    ["init", /init \[--tools <ids>\] \[--force\]/],
    ["update", /update \[--tools <ids>\] \[--force\]/],
    ["tools", /planlet tools/],
    ["onboard", /planlet onboard/],
  ] as const) {
    for (const form of [
      ["help", command],
      [command, "--help"],
    ] as const) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      assert.equal(
        await main([...form], {
          cwd: "/path/that/does/not/need/to/exist",
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value),
        }),
        0,
      );
      assert.match(stdout.join(""), pattern);
      assert.equal(stderr.join(""), "");
    }
  }
});

test("onboard prints exactly the agent snippet and works outside a repository", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await main(["onboard"], {
      cwd: "/path/that/does/not/need/to/exist",
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    }),
    0,
  );
  assert.equal(stdout.join(""), `${renderAgentSnippet()}\n`);
  assert.equal(stderr.join(""), "");
});

test("onboard in a non-repository directory writes no files", async () => {
  const root = mkdtempSync(join(tmpdir(), "planlet-onboard-"));
  try {
    const stdout: string[] = [];
    assert.equal(
      await main(["onboard"], {
        cwd: root,
        stdout: (value) => stdout.push(value),
        stderr: () => {},
      }),
      0,
    );
    assert.equal(stdout.join(""), `${renderAgentSnippet()}\n`);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid commands and arguments fail with usage before repository discovery", async () => {
  for (const arguments_ of [["status"], ["bogus"], ["list", "--bogus"]]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    assert.equal(
      await main(arguments_, {
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

test("unexpected TypeErrors from output sinks propagate", async () => {
  const failure = new TypeError("broken output sink");

  await assert.rejects(
    async () =>
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

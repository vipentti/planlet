import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "release.yml");
const workflow = readFileSync(workflowPath, "utf8");
const VERSION = "1.2.3";

const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function extractInlineBlock(stepName: string): string {
  const start = workflow.indexOf(`- name: ${stepName}`);
  assert.ok(start >= 0, `step ${stepName} missing`);
  const marker = "<<'NODE'";
  const heredoc = workflow.indexOf(marker, start);
  const codeStart = heredoc + marker.length;
  const codeEnd = workflow.indexOf("\n          NODE", codeStart);
  assert.ok(
    codeStart > 0 && codeEnd > codeStart,
    `inline block in ${stepName} missing`,
  );
  const lines = workflow.slice(codeStart, codeEnd).split("\n");
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  const indent = nonEmpty.reduce(
    (min, line) => Math.min(min, /^ */.exec(line)?.[0].length ?? 0),
    Infinity,
  );
  return lines.map((line) => line.slice(indent)).join("\n");
}

function runInlineBlock(
  report: unknown,
  options: { version?: string } = {},
): { status: number; stdout: string; stderr: string; envFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "planlet-pack-inline-"));
  tempDirs.push(dir);
  const envFile = join(dir, "github-env.txt");
  writeFileSync(join(dir, "pack.json"), JSON.stringify(report) + "\n", "utf8");
  writeFileSync(
    join(dir, "block.mjs"),
    extractInlineBlock("Build reviewed package artifact"),
    "utf8",
  );
  const r = spawnSync(process.execPath, [join(dir, "block.mjs")], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      VERSION: options.version ?? VERSION,
      GITHUB_ENV: envFile,
    },
  });
  return {
    status: r.status ?? -1,
    stdout: r.stdout,
    stderr: r.stderr,
    envFile,
  };
}

function validReport(
  filename = `vipentti-planlet-${VERSION}.tgz`,
): Array<{ filename: string; integrity: string }> {
  return [{ filename, integrity: "sha512-abc123" }];
}

function assertRefused(result: {
  status: number;
  stderr: string;
  envFile: string;
}) {
  assert.notEqual(result.status, 0);
  assert.notEqual(result.stderr.trim(), "");
  assert.equal(
    existsSync(result.envFile) ? readFileSync(result.envFile, "utf8") : "",
    "",
  );
}

test("valid packed artifact records PACKAGE_TARBALL", () => {
  const result = runInlineBlock(validReport());
  assert.equal(result.status, 0, result.stderr);
  const runDir = dirname(result.envFile);
  assert.equal(
    readFileSync(result.envFile, "utf8"),
    `PACKAGE_TARBALL=${join(runDir, `vipentti-planlet-${VERSION}.tgz`)}\n`,
  );
});

test("filename containing newline is rejected", () => {
  assertRefused(
    runInlineBlock(validReport(`vipentti-planlet-${VERSION}.tgz\nEVIL=1`)),
  );
});

test("filename containing carriage return is rejected", () => {
  assertRefused(
    runInlineBlock(validReport(`vipentti-planlet-${VERSION}.tgz\rEVIL=1`)),
  );
});

test("filename containing path separators is rejected", () => {
  assertRefused(runInlineBlock(validReport(`sub/${VERSION}.tgz`)));
  assertRefused(runInlineBlock(validReport(`sub\\${VERSION}.tgz`)));
});

test("unexpected package basename is rejected", () => {
  assertRefused(runInlineBlock(validReport("evil-planlet-1.2.3.tgz")));
});

test("unexpected version is rejected", () => {
  assertRefused(runInlineBlock(validReport(), { version: "9.9.9" }));
});

test("multiple pack results are rejected", () => {
  assertRefused(runInlineBlock([validReport()[0], validReport()[0]]));
});

test("empty or missing integrity is rejected", () => {
  assertRefused(
    runInlineBlock([
      { filename: `vipentti-planlet-${VERSION}.tgz`, integrity: "" },
    ]),
  );
  assertRefused(
    runInlineBlock([{ filename: `vipentti-planlet-${VERSION}.tgz` }]),
  );
});

test("path escaping RUNNER_TEMP is rejected", () => {
  assertRefused(runInlineBlock(validReport("..")));
  assertRefused(runInlineBlock(validReport("...")));
});

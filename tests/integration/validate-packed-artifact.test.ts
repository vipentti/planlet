import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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

function extractValidatorBlock(): string {
  const start = workflow.indexOf("- name: Validate reviewed package artifact");
  assert.ok(start >= 0, "validator step missing");
  const marker = "<<'NODE'";
  const heredoc = workflow.indexOf(marker, start);
  const codeStart = heredoc + marker.length;
  const codeEnd = workflow.indexOf("\n          NODE", codeStart);
  assert.ok(codeStart > 0 && codeEnd > codeStart, "validator block missing");
  const lines = workflow.slice(codeStart, codeEnd).split("\n");
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  const indent = nonEmpty.reduce(
    (min, line) => Math.min(min, /^ */.exec(line)?.[0].length ?? 0),
    Infinity,
  );
  return lines.map((line) => line.slice(indent)).join("\n");
}

function runValidator(report: unknown): {
  status: number;
  stderr: string;
  outputFile: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "planlet-pack-reject-"));
  tempDirs.push(dir);
  const packDir = join(dir, "pack");
  mkdirSync(packDir);
  const outputFile = join(dir, "output.txt");
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(report) + "\n");
  writeFileSync(join(dir, "block.mjs"), extractValidatorBlock(), "utf8");
  const r = spawnSync(process.execPath, [join(dir, "block.mjs")], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      VERSION,
      GITHUB_OUTPUT: outputFile,
    },
  });
  return { status: r.status ?? -1, stderr: r.stderr, outputFile };
}

function report(
  filename: string,
  integrity = "sha512-abc123",
): Array<{ filename: string; integrity: string }> {
  return [{ filename, integrity }];
}

function assertRejected(result: {
  status: number;
  stderr: string;
  outputFile: string;
}) {
  assert.notEqual(result.status, 0);
  assert.notEqual(result.stderr.trim(), "");
  assert.equal(
    existsSync(result.outputFile)
      ? readFileSync(result.outputFile, "utf8")
      : "",
    "",
  );
}

test("filename containing newline is rejected", () => {
  assertRejected(
    runValidator(report(`vipentti-planlet-${VERSION}.tgz\nEVIL=1`)),
  );
});

test("filename containing carriage return is rejected", () => {
  assertRejected(
    runValidator(report(`vipentti-planlet-${VERSION}.tgz\rEVIL=1`)),
  );
});

test("filename containing path separators is rejected", () => {
  assertRejected(runValidator(report(`sub/${VERSION}.tgz`)));
  assertRejected(runValidator(report(`sub\\${VERSION}.tgz`)));
});

test("unexpected package basename is rejected", () => {
  assertRejected(runValidator(report("evil-planlet-1.2.3.tgz")));
});

test("unexpected version is rejected", () => {
  assertRejected(runValidator(report("vipentti-planlet-9.9.9.tgz")));
});

test("multiple pack results are rejected", () => {
  assertRejected(
    runValidator([
      report(`vipentti-planlet-${VERSION}.tgz`)[0],
      report(`vipentti-planlet-${VERSION}.tgz`)[0],
    ]),
  );
});

test("empty or missing integrity is rejected", () => {
  assertRejected(runValidator(report(`vipentti-planlet-${VERSION}.tgz`, "")));
  assertRejected(
    runValidator([{ filename: `vipentti-planlet-${VERSION}.tgz` }]),
  );
});

test("path escaping RUNNER_TEMP is rejected", () => {
  assertRejected(runValidator(report("..")));
  assertRejected(runValidator(report("...")));
});

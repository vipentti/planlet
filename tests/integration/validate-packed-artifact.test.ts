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
const helper = join(repoRoot, "scripts", "validate-packed-artifact.mjs");
const FIXED_NAME = "@vipentti/planlet";
const VERSION = "1.2.3";

const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runHelper(
  report: unknown,
  options: { name?: string; version?: string } = {},
): { status: number; stdout: string; stderr: string; envFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "planlet-pack-validate-"));
  tempDirs.push(dir);
  const envFile = join(dir, "github-env.txt");
  writeFileSync(join(dir, "pack.json"), JSON.stringify(report) + "\n", "utf8");
  const r = spawnSync(process.execPath, [helper], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      VERSION: options.version ?? VERSION,
      PACKAGE_NAME: options.name ?? FIXED_NAME,
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
  const result = runHelper(validReport());
  assert.equal(result.status, 0, result.stderr);
  const runDir = dirname(result.envFile);
  assert.equal(
    readFileSync(result.envFile, "utf8"),
    `PACKAGE_TARBALL=${join(runDir, `vipentti-planlet-${VERSION}.tgz`)}\n`,
  );
});

test("filename containing newline is rejected", () => {
  assertRefused(
    runHelper(validReport(`vipentti-planlet-${VERSION}.tgz\nEVIL=1`)),
  );
});

test("filename containing carriage return is rejected", () => {
  assertRefused(
    runHelper(validReport(`vipentti-planlet-${VERSION}.tgz\rEVIL=1`)),
  );
});

test("filename containing path separators is rejected", () => {
  assertRefused(runHelper(validReport(`sub/${VERSION}.tgz`)));
  assertRefused(runHelper(validReport(`sub\\${VERSION}.tgz`)));
});

test("unexpected package name is rejected", () => {
  assertRefused(runHelper(validReport(), { name: "@evil/planlet" }));
});

test("unexpected version is rejected", () => {
  assertRefused(runHelper(validReport(), { version: "9.9.9" }));
});

test("unexpected tarball basename is rejected", () => {
  assertRefused(runHelper(validReport("other.tgz")));
});

test("multiple pack results are rejected", () => {
  assertRefused(runHelper([validReport()[0], validReport()[0]]));
});

test("empty or missing integrity is rejected", () => {
  assertRefused(
    runHelper([{ filename: `vipentti-planlet-${VERSION}.tgz`, integrity: "" }]),
  );
  assertRefused(runHelper([{ filename: `vipentti-planlet-${VERSION}.tgz` }]));
});

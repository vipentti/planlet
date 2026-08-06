import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const EXPECTED = `vipentti-planlet-${VERSION}.tgz`;

const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function extractNodeBlock(stepName: string): string {
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

function extractShellBlock(stepName: string): string {
  const start = workflow.indexOf(`- name: ${stepName}`);
  assert.ok(start >= 0, `step ${stepName} missing`);
  const runMarker = workflow.indexOf("run: |", start);
  assert.ok(runMarker > 0, `run block in ${stepName} missing`);
  const bodyStart = workflow.indexOf("\n", runMarker) + 1;
  const bodyEnd = workflow.indexOf("\n      - ", bodyStart);
  const lines = workflow
    .slice(bodyStart, bodyEnd > 0 ? bodyEnd : undefined)
    .split("\n");
  return lines
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .trim();
}

function makeFixture(withDist: boolean): { dir: string; tarball: string } {
  const dir = mkdtempSync(join(tmpdir(), "planlet-pack-contract-"));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "@vipentti/planlet",
        version: VERSION,
        bin: { planlet: "dist/planlet.mjs" },
        files: ["dist"],
      },
      null,
      2,
    ) + "\n",
  );
  if (withDist) {
    mkdirSync(join(dir, "dist"));
    writeFileSync(
      join(dir, "dist", "planlet.mjs"),
      "#!/usr/bin/env node\nconsole.log(process.env.PLANLET_TEST_VERSION ?? " +
        JSON.stringify(VERSION) +
        ");\n",
      "utf8",
    );
  }
  const packDir = join(dir, "pack");
  mkdirSync(packDir);
  const pack = runNpm(dir, [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    packDir,
  ]);
  assert.equal(pack.status, 0, pack.stderr);
  writeFileSync(join(packDir, "pack.json"), pack.stdout, "utf8");
  return { dir, tarball: join(packDir, EXPECTED) };
}

function runNpm(dir: string, args: string[]) {
  return spawnSync("npm", args, {
    cwd: dir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function runValidator(dir: string): {
  status: number;
  stdout: string;
  stderr: string;
  outputFile: string;
} {
  const outputFile = join(dir, "output.txt");
  writeFileSync(
    join(dir, "block.mjs"),
    extractNodeBlock("Validate reviewed package artifact"),
    "utf8",
  );
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
  return {
    status: r.status ?? -1,
    stdout: r.stdout,
    stderr: r.stderr,
    outputFile,
  };
}

function runSmoke(dir: string): {
  status: number;
  stdout: string;
  stderr: string;
} {
  writeFileSync(
    join(dir, "smoke.sh"),
    extractShellBlock("Smoke-test installed package"),
    "utf8",
  );
  const r = spawnSync("bash", [join(dir, "smoke.sh")], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      VERSION,
    },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

test("package packed without dist lacks the CLI and the validator rejects it", () => {
  const fixture = makeFixture(false);
  const listing = spawnSync("tar", ["-tzf", fixture.tarball], {
    encoding: "utf8",
  });
  assert.equal(listing.status, 0);
  assert.doesNotMatch(listing.stdout, /package\/dist\/planlet\.mjs/);

  const result = runValidator(fixture.dir);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /must contain a non-empty package\/dist\/planlet\.mjs/,
  );
  assert.equal(
    existsSync(result.outputFile)
      ? readFileSync(result.outputFile, "utf8")
      : "",
    "",
  );
});

test("package packed after build validates and exports digest values", () => {
  const fixture = makeFixture(true);
  const listing = spawnSync("tar", ["-tzf", fixture.tarball], {
    encoding: "utf8",
  });
  assert.match(listing.stdout, /package\/dist\/planlet\.mjs/);

  const result = runValidator(fixture.dir);
  assert.equal(result.status, 0, result.stderr);
  const output = readFileSync(result.outputFile, "utf8");
  assert.match(output, new RegExp(`package-filename=${EXPECTED}`));
  assert.match(output, /package-sha256=[0-9a-f]{64}/);
  assert.match(output, /package-integrity=sha512-/);
  const sha = createHash("sha256")
    .update(readFileSync(fixture.tarball))
    .digest("hex");
  assert.match(output, new RegExp(`package-sha256=${sha}`));
});

test("installed binary smoke test passes for the expected version", () => {
  const fixture = makeFixture(true);
  const result = runSmoke(fixture.dir);
  assert.equal(result.status, 0, result.stderr);
});

test("installed binary smoke test rejects a mismatched version", () => {
  const fixture = makeFixture(true);
  // Override the CLI output to a wrong version, repack, and verify the smoke
  // block fails closed before any publication could proceed.
  const cli = join(fixture.dir, "dist", "planlet.mjs");
  writeFileSync(cli, '#!/usr/bin/env node\nconsole.log("9.9.9");\n', "utf8");
  const repack = runNpm(fixture.dir, [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    join(fixture.dir, "pack"),
  ]);
  assert.equal(repack.status, 0, repack.stderr);
  writeFileSync(join(fixture.dir, "pack", "pack.json"), repack.stdout, "utf8");
  const result = runSmoke(fixture.dir);
  assert.notEqual(result.status, 0);
});

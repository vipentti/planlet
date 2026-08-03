import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const shim = process.platform === "win32" ? "planlet.cmd" : "planlet";

function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, [...arguments_], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  assert.equal(result.error, undefined);
  return result;
}

/**
 * The tarball, not the working tree, is the artifact users get: this is the
 * only check that catches a missing build hook, an over-broad file allowlist,
 * or canonical skills that resolve in development but not from an install.
 */
test("the published tarball installs and runs through its bin shim", () => {
  const scratch = mkdtempSync(join(tmpdir(), "planlet-pack-"));
  try {
    // Never delete dist/ here: sibling test files run in parallel against it.
    const packed = run(
      npm,
      ["pack", "--json", "--pack-destination", scratch],
      packageRoot,
    );
    assert.equal(packed.status, 0, packed.stderr);
    // npm >=12 keys the report by package name; older npm emits an array.
    const report = JSON.parse(packed.stdout) as Record<
      string,
      { files: readonly { path: string }[] }
    >;
    const files = Object.values(report)[0]!.files.map((file) => file.path);

    for (const expected of [
      "dist/planlet.mjs",
      "package.json",
      "CHANGELOG.md",
      "README.md",
      "LICENSE",
      "skills/planlet-plan/SKILL.md",
      "skills/planlet-implement/SKILL.md",
      "skills/planlet-complete/SKILL.md",
    ]) {
      assert.ok(files.includes(expected), `missing ${expected} in ${files}`);
    }
    const tarball = join(
      scratch,
      readdirSync(scratch).find((name) => name.endsWith(".tgz"))!,
    );
    const installRoot = join(scratch, "install");
    mkdirSync(installRoot);
    const installed = run(
      npm,
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--offline",
        tarball,
      ],
      installRoot,
    );
    assert.equal(installed.status, 0, installed.stderr);

    const executable = join(installRoot, "node_modules", ".bin", shim);
    const repository = join(scratch, "repository");
    mkdirSync(join(repository, ".git"), { recursive: true });

    const initialized = run(executable, ["init"], repository);
    assert.equal(initialized.status, 0, initialized.stderr);
    const listed = run(executable, ["list"], repository);
    assert.equal(listed.status, 0, listed.stderr);
    const tools = run(executable, ["tools"], repository);
    assert.equal(tools.status, 0, tools.stderr);
    assert.ok(tools.stdout.includes("installed"), tools.stdout);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

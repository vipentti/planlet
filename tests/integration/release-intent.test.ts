import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function extractIntentBlock(): string {
  const start = workflow.indexOf("- name: Verify release intent is unchanged");
  assert.ok(start >= 0, "release-intent step missing");
  const runMarker = workflow.indexOf("run: |", start);
  const bodyStart = workflow.indexOf("\n", runMarker) + 1;
  const bodyEnd = workflow.indexOf("\n      - ", bodyStart);
  return workflow
    .slice(bodyStart, bodyEnd > 0 ? bodyEnd : undefined)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .trim();
}

function runGit(wd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd: wd, encoding: "utf8" });
}

function makeRepo(): { dir: string; baseSha: string; releaseSha: string } {
  const base = mkdtempSync(join(tmpdir(), "planlet-intent-"));
  tempDirs.push(base);
  const dir = join(base, "work");
  const origin = join(base, "origin.git");
  mkdirSync(dir);
  runGit(base, "init", "--bare", "-q", origin);
  runGit(dir, "init", "-q", "-b", "main");
  runGit(dir, "config", "user.email", "t@test");
  runGit(dir, "config", "user.name", "test");

  writeFileSync(
    join(dir, "package.json"),
    '{"name":"@vipentti/planlet","version":"0.1.0"}\n',
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    '{"name":"@vipentti/planlet","version":"0.1.0"}\n',
  );
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-08-05\n\n- base\n",
  );
  writeFileSync(join(dir, "README.md"), "readme\n");
  runGit(dir, "add", ".");
  runGit(dir, "commit", "-q", "-m", "base");
  const baseSha = runGit(dir, "rev-parse", "HEAD").stdout.trim();

  writeFileSync(
    join(dir, "package.json"),
    '{"name":"@vipentti/planlet","version":"1.0.0"}\n',
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    '{"name":"@vipentti/planlet","version":"1.0.0"}\n',
  );
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-08-06\n\n- release\n\n## [0.1.0] - 2026-08-05\n\n- base\n",
  );
  runGit(dir, "add", ".");
  runGit(dir, "commit", "-q", "-m", "release: 1.0.0");
  const releaseSha = runGit(dir, "rev-parse", "HEAD").stdout.trim();
  runGit(dir, "remote", "add", "origin", origin);
  runGit(dir, "push", "-q", "-u", "origin", "main");
  return { dir, baseSha, releaseSha };
}

function runIntentCheck(dir: string, releaseSha: string): number {
  const block = extractIntentBlock();
  const r = spawnSync("bash", ["-c", block], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GITHUB_SHA: releaseSha, GH_TOKEN: "dummy" },
  });
  return r.status ?? -1;
}

function commitAndPush(dir: string, message: string, mutate: () => void) {
  mutate();
  runGit(dir, "add", ".");
  runGit(dir, "commit", "-q", "-m", message);
  runGit(dir, "push", "-q", "origin", "main");
}

test("release intent check passes when main equals the release commit", () => {
  const repo = makeRepo();
  assert.equal(runIntentCheck(repo.dir, repo.releaseSha), 0);
});

test("release intent check passes for an unrelated descendant", () => {
  const repo = makeRepo();
  commitAndPush(repo.dir, "docs: unrelated", () => {
    writeFileSync(join(repo.dir, "README.md"), "readme updated\n");
  });
  assert.equal(runIntentCheck(repo.dir, repo.releaseSha), 0);
});

test("release intent check fails when a descendant modifies CHANGELOG.md", () => {
  const repo = makeRepo();
  commitAndPush(repo.dir, "changelog change", () => {
    writeFileSync(join(repo.dir, "CHANGELOG.md"), "changed\n");
  });
  assert.notEqual(runIntentCheck(repo.dir, repo.releaseSha), 0);
});

test("release intent check fails when a descendant modifies package.json", () => {
  const repo = makeRepo();
  commitAndPush(repo.dir, "package change", () => {
    writeFileSync(
      join(repo.dir, "package.json"),
      '{"name":"x","version":"2.0.0"}\n',
    );
  });
  assert.notEqual(runIntentCheck(repo.dir, repo.releaseSha), 0);
});

test("release intent check fails when a descendant modifies package-lock.json", () => {
  const repo = makeRepo();
  commitAndPush(repo.dir, "lock change", () => {
    writeFileSync(
      join(repo.dir, "package-lock.json"),
      '{"name":"x","version":"2.0.0"}\n',
    );
  });
  assert.notEqual(runIntentCheck(repo.dir, repo.releaseSha), 0);
});

test("release intent check fails after the release commit is reverted", () => {
  const repo = makeRepo();
  const revert = runGit(repo.dir, "revert", "--no-edit", repo.releaseSha);
  assert.equal(revert.status, 0, revert.stderr);
  runGit(repo.dir, "push", "-q", "origin", "main");
  assert.notEqual(runIntentCheck(repo.dir, repo.releaseSha), 0);
});

test("release intent check fails when the release SHA is no longer an ancestor", () => {
  const repo = makeRepo();
  runGit(repo.dir, "reset", "--hard", repo.baseSha);
  runGit(repo.dir, "push", "-q", "--force", "origin", "main");
  assert.notEqual(runIntentCheck(repo.dir, repo.releaseSha), 0);
});

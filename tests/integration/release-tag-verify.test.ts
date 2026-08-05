import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceVerifier = join(repoRoot, "scripts", "verify-release-tag.mjs");

const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(repo: string, ...args: string[]) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8" });
}

function makeRepo(): { dir: string; head: string; other: string } {
  const base = mkdtempSync(join(tmpdir(), "planlet-tag-verify-"));
  tempDirs.push(base);
  const dir = join(base, "work");
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@test");
  git(dir, "config", "user.name", "test");

  // SSH signing key + allowed signers, mirroring the release-utility harness.
  const key = join(base, "key");
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], {
    encoding: "utf8",
  });
  const pub = spawnSync("ssh-keygen", ["-y", "-f", key], {
    encoding: "utf8",
  }).stdout.trim();
  const allowed = join(dir, "..", "allowed");
  writeFileSync(allowed, `test namespaces="git" ${pub}\n`);
  git(dir, "config", "user.signingkey", key);
  git(dir, "config", "gpg.format", "ssh");
  git(dir, "config", "gpg.ssh.allowedSignersFile", allowed);
  // Isolate from global signing config: sign only when a test asks for it.
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "tag.gpgsign", "false");

  writeFileSync(join(dir, "file.txt"), "base\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  const head = git(dir, "rev-parse", "HEAD").stdout.trim();

  writeFileSync(join(dir, "file.txt"), "other\n");
  git(dir, "commit", "-q", "-am", "other");
  const other = git(dir, "rev-parse", "HEAD").stdout.trim();
  return { dir, head, other };
}

function verify(
  repo: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [sourceVerifier, ...args], {
    cwd: repo,
    encoding: "utf8",
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

test("valid signed annotated tag verifies and prints the object SHA", () => {
  const { dir, head } = makeRepo();
  git(dir, "tag", "-a", "-s", "v0.3.0", "-m", "v0.3.0", head);
  const out = verify(dir, [
    "--tag",
    "v0.3.0",
    "--target",
    head,
    "--message",
    "v0.3.0",
  ]);
  assert.equal(out.status, 0, out.stderr);
  const expected = git(dir, "rev-parse", "refs/tags/v0.3.0").stdout.trim();
  assert.equal(out.stdout.trim(), expected);
  assert.match(out.stdout.trim(), /^[0-9a-f]{40}$/);
});

test("lightweight tag refuses", () => {
  const { dir, head } = makeRepo();
  git(dir, "tag", "v0.3.0", head);
  const out = verify(dir, [
    "--tag",
    "v0.3.0",
    "--target",
    head,
    "--message",
    "v0.3.0",
  ]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /not an annotated tag/);
});

test("tag pointing at the wrong commit refuses", () => {
  const { dir, head, other } = makeRepo();
  git(dir, "tag", "-a", "-s", "v0.3.0", "-m", "v0.3.0", head);
  const out = verify(dir, [
    "--tag",
    "v0.3.0",
    "--target",
    other,
    "--message",
    "v0.3.0",
  ]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /points to/);
});

test("wrong message subject refuses", () => {
  const { dir, head } = makeRepo();
  git(dir, "tag", "-a", "-s", "v0.3.0", "-m", "other message", head);
  const out = verify(dir, [
    "--tag",
    "v0.3.0",
    "--target",
    head,
    "--message",
    "v0.3.0",
  ]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /message is/);
});

test("unsigned annotated tag refuses", () => {
  const { dir, head } = makeRepo();
  // git tag -a without -s: annotated but not signed.
  git(dir, "tag", "-a", "v0.3.0", "-m", "v0.3.0", head);
  const out = verify(dir, [
    "--tag",
    "v0.3.0",
    "--target",
    head,
    "--message",
    "v0.3.0",
  ]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /verify-tag failed/);
});

test("missing tag refuses with a diagnostic", () => {
  const { dir, head } = makeRepo();
  const out = verify(dir, [
    "--tag",
    "v9.9.9",
    "--target",
    head,
    "--message",
    "v9.9.9",
  ]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /not an annotated tag/);
});

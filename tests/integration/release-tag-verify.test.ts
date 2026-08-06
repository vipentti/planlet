import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyReleaseTag } from "../../scripts/verify-release-tag.mjs";

const tempDirs: string[] = [];
const gpgHomes = new Map<string, string>();
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function gpgHomePath(home: string): string {
  if (process.platform !== "win32" || home.startsWith("/")) return home;
  return `/${home.slice(0, 1).toLowerCase()}${home.slice(2).replaceAll("\\", "/")}`;
}

function gpgEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GNUPGHOME: gpgHomePath(home),
    MSYS2_ARG_CONV_EXCL: "*",
    MSYS_NO_PATHCONV: "1",
  };
}

function startGpgAgent(home: string) {
  if (process.platform === "win32") return;
  const result = spawnSync("gpg-agent", ["--daemon"], {
    stdio: "ignore",
    env: gpgEnv(home),
  });
  assert.equal(result.status, 0);
}

function git(repo: string, ...args: string[]) {
  const home = gpgHomes.get(repo);
  return spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: home ? gpgEnv(home) : process.env,
  });
}

function gpg(home: string, ...args: string[]) {
  const result = spawnSync(
    "gpg",
    ["--batch", "--pinentry-mode", "loopback", "--passphrase", "", ...args],
    { encoding: "utf8", env: gpgEnv(home) },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

function makeRepo(): {
  dir: string;
  head: string;
  other: string;
  home: string;
  fingerprint: string;
} {
  const base = mkdtempSync(join(tmpdir(), "planlet-tag-verify-"));
  tempDirs.push(base);
  const dir = join(base, "work");
  const home = join(base, "gnupg");
  mkdirSync(dir);
  mkdirSync(home, { mode: 0o700 });
  startGpgAgent(home);
  gpg(
    home,
    "--quick-generate-key",
    "Planlet Tag Test <tag@example.test>",
    "rsa2048",
    "sign",
    "1d",
  );
  const fingerprint = gpg(home, "--with-colons", "--list-secret-keys")
    .stdout.split("\n")
    .find((line) => line.startsWith("fpr:"))
    ?.split(":")[9];
  assert.match(fingerprint ?? "", /^[0-9A-Fa-f]{40}$/);
  gpgHomes.set(dir, home);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@test");
  git(dir, "config", "user.name", "test");
  git(dir, "config", "user.signingkey", fingerprint as string);
  git(dir, "config", "gpg.format", "openpgp");
  git(dir, "config", "gpg.minTrustLevel", "ultimate");
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
  return { dir, head, other, home, fingerprint: fingerprint as string };
}

function verify(
  repo: ReturnType<typeof makeRepo>,
  args: { tag: string; target: string; message: string },
) {
  const previous = process.env.GNUPGHOME;
  process.env.GNUPGHOME = gpgHomePath(repo.home);
  try {
    return verifyReleaseTag({
      cwd: repo.dir,
      expectedFingerprint: repo.fingerprint,
      ...args,
    });
  } finally {
    if (previous === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = previous;
  }
}

test("valid signed annotated tag verifies and returns the object SHA", () => {
  const repo = makeRepo();
  git(repo.dir, "tag", "-a", "-s", "v0.3.0", "-m", "v0.3.0", repo.head);
  const out = verify(repo, {
    tag: "v0.3.0",
    target: repo.head,
    message: "v0.3.0",
  });
  assert.ok(out.ok, out.ok ? "" : out.error);
  if (out.ok) {
    const expected = git(
      repo.dir,
      "rev-parse",
      "refs/tags/v0.3.0",
    ).stdout.trim();
    assert.equal(out.objectSha, expected);
    assert.match(out.objectSha, /^[0-9a-f]{40}$/);
  }
});

test("lightweight tag refuses", () => {
  const repo = makeRepo();
  git(repo.dir, "tag", "v0.3.0", repo.head);
  const out = verify(repo, {
    tag: "v0.3.0",
    target: repo.head,
    message: "v0.3.0",
  });
  assert.ok(!out.ok);
  if (!out.ok) assert.match(out.error, /not an annotated tag/);
});

test("tag pointing at the wrong commit refuses", () => {
  const repo = makeRepo();
  git(repo.dir, "tag", "-a", "-s", "v0.3.0", "-m", "v0.3.0", repo.head);
  const out = verify(repo, {
    tag: "v0.3.0",
    target: repo.other,
    message: "v0.3.0",
  });
  assert.ok(!out.ok);
  if (!out.ok) assert.match(out.error, /points to/);
});

test("wrong message subject refuses", () => {
  const repo = makeRepo();
  git(repo.dir, "tag", "-a", "-s", "v0.3.0", "-m", "other message", repo.head);
  const out = verify(repo, {
    tag: "v0.3.0",
    target: repo.head,
    message: "v0.3.0",
  });
  assert.ok(!out.ok);
  if (!out.ok) assert.match(out.error, /message is/);
});

test("unsigned annotated tag refuses", () => {
  const repo = makeRepo();
  git(repo.dir, "tag", "-a", "v0.3.0", "-m", "v0.3.0", repo.head);
  const out = verify(repo, {
    tag: "v0.3.0",
    target: repo.head,
    message: "v0.3.0",
  });
  assert.ok(!out.ok);
  if (!out.ok) assert.match(out.error, /verify-tag failed/);
});

test("missing tag refuses with a diagnostic", () => {
  const repo = makeRepo();
  const out = verify(repo, {
    tag: "v9.9.9",
    target: repo.head,
    message: "v9.9.9",
  });
  assert.ok(!out.ok);
  if (!out.ok) assert.match(out.error, /not an annotated tag/);
});

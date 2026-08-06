import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { verifyReleaseTag } from "../../scripts/verify-release-tag.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = readFileSync(
  join(repoRoot, ".github", "workflows", "release.yml"),
  "utf8",
);
const tempDirs: string[] = [];

test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

interface KeyFixture {
  readonly home: string;
  readonly primary: string;
  readonly signing: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

interface RepoFixture {
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly target: string;
}

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

function workflowEnv(home: string): NodeJS.ProcessEnv {
  const env = gpgEnv(home);
  if (process.platform === "win32") {
    delete env.MSYS2_ARG_CONV_EXCL;
    delete env.MSYS_NO_PATHCONV;
  }
  return env;
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

function fingerprintAfter(record: string, kind: "sec" | "ssb"): string {
  const lines = record.split("\n").map((line) => line.split(":"));
  const index = lines.findIndex((fields) => fields[0] === kind);
  const fingerprint = index >= 0 ? lines[index + 1]?.[9] : undefined;
  assert.match(fingerprint ?? "", /^[0-9A-Fa-f]{40}$/);
  return fingerprint as string;
}

function makeKey(home: string, name: string): KeyFixture {
  mkdirSync(home, { mode: 0o700 });
  gpg(
    home,
    "--quick-generate-key",
    `${name} <${name}@example.test>`,
    "rsa2048",
    "sign",
    "1d",
  );
  const primaryRecord = gpg(home, "--with-colons", "--list-secret-keys").stdout;
  const primary = fingerprintAfter(primaryRecord, "sec");
  gpg(home, "--quick-add-key", primary, "rsa2048", "sign", "1d");
  const record = gpg(home, "--with-colons", "--list-secret-keys").stdout;
  const signing = fingerprintAfter(record, "ssb");
  const publicKey = gpg(home, "--armor", "--export", primary).stdout;
  const privateKey = gpg(
    home,
    "--armor",
    "--export-secret-keys",
    primary,
  ).stdout;
  return { home, primary, signing, publicKey, privateKey };
}

const fixtureRoot = mkdtempSync(join(tmpdir(), "planlet-release-gpg-"));
tempDirs.push(fixtureRoot);
const expectedKey = makeKey(join(fixtureRoot, "expected"), "expected-release");
const secondKey = makeKey(join(fixtureRoot, "second"), "second-release");

function importMaterial(home: string, material: string) {
  const result = spawnSync("gpg", ["--batch", "--import"], {
    input: material,
    encoding: "utf8",
    env: gpgEnv(home),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function withGpgHome<T>(home: string, callback: () => T): T {
  const previous = process.env.GNUPGHOME;
  process.env.GNUPGHOME = gpgHomePath(home);
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = previous;
  }
}

function git(repo: RepoFixture, ...args: string[]) {
  return spawnSync("git", args, {
    cwd: repo.dir,
    encoding: "utf8",
    env: repo.env,
  });
}

function makeSignedRepo(
  home: string,
  signer: string,
  tag: string,
): RepoFixture {
  const base = mkdtempSync(join(tmpdir(), "planlet-release-signed-"));
  tempDirs.push(base);
  const dir = join(base, "repo");
  mkdirSync(dir);
  const env = gpgEnv(home);
  const run = (...args: string[]) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
  assert.equal(run("init", "-q").status, 0);
  assert.equal(run("config", "user.name", "Release Test").status, 0);
  assert.equal(run("config", "user.email", "release@example.test").status, 0);
  assert.equal(run("config", "gpg.format", "openpgp").status, 0);
  assert.equal(run("config", "commit.gpgsign", "false").status, 0);
  assert.equal(run("config", "user.signingkey", signer).status, 0);
  writeFileSync(join(dir, "content"), "release\n");
  assert.equal(run("add", ".").status, 0);
  assert.equal(run("commit", "-q", "-m", "init").status, 0);
  const signed = run("tag", "-a", "-s", tag, "-m", `Release ${tag}`, "HEAD");
  assert.equal(signed.status, 0, signed.stdout + signed.stderr);
  const target = run("rev-parse", "HEAD").stdout.trim();
  return { dir, env, target };
}

function verify(repo: RepoFixture, expectedFingerprint: string) {
  return withGpgHome(repo.env.GNUPGHOME as string, () =>
    verifyReleaseTag({
      tag: "v1.2.3",
      target: repo.target,
      message: "Release v1.2.3",
      expectedFingerprint,
      cwd: repo.dir,
    }),
  );
}

function stepSection(name: string): string {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.ok(start >= 0, `workflow step ${name} missing`);
  const end = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, end < 0 ? workflow.length : end);
}

function shellBlock(name: string): string {
  const section = stepSection(name);
  const marker = "run: |";
  const markerIndex = section.indexOf(marker);
  assert.ok(markerIndex >= 0, `workflow shell block ${name} missing`);
  return section
    .slice(section.indexOf("\n", markerIndex) + 1)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .trim();
}

function tagVerifierBlock(): string {
  const section = stepSection("Ensure exact signed release tag");
  const start = section.indexOf("verify_tag() {");
  const end = section.indexOf("\n          if [", start);
  assert.ok(
    start >= 0 && end > start,
    "workflow tag verifier function missing",
  );
  return section
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .trim();
}

function runSetup(name: string, env: NodeJS.ProcessEnv, cwd = repoRoot) {
  const base = mkdtempSync(join(tmpdir(), "planlet-release-gpg-step-"));
  tempDirs.push(base);
  const script = join(base, `${name}.sh`);
  writeFileSync(script, shellBlock(name));
  chmodSync(script, 0o700);
  return spawnSync("bash", [script], {
    cwd,
    encoding: "utf8",
    env,
  });
}

function runWorkflowTagVerifier(
  repo: RepoFixture,
  expectedFingerprint: string,
) {
  const base = mkdtempSync(join(tmpdir(), "planlet-release-gpg-workflow-"));
  tempDirs.push(base);
  const script = join(base, "verify-tag.sh");
  writeFileSync(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `RUNNER_TEMP=${JSON.stringify(gpgHomePath(base))}`,
      `target=${repo.target}`,
      `expected=${expectedFingerprint.toUpperCase()}`,
      tagVerifierBlock(),
      'verify_tag "v1.2.3"',
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o700);
  return spawnSync("bash", [script], {
    cwd: repo.dir,
    encoding: "utf8",
    env: repo.env,
  });
}

function emptyRepo(home: string): RepoFixture {
  const base = mkdtempSync(join(tmpdir(), "planlet-release-gpg-empty-"));
  tempDirs.push(base);
  const dir = join(base, "repo");
  mkdirSync(dir);
  const env = gpgEnv(home);
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, env });
  assert.equal(init.status, 0, String(init.stderr));
  for (const args of [
    ["config", "gpg.format", "openpgp"],
    ["config", "commit.gpgsign", "false"],
  ]) {
    const config = spawnSync("git", args, { cwd: dir, env });
    assert.equal(config.status, 0, String(config.stderr));
  }
  return { dir, env, target: "" };
}

function validSigStatus(fingerprint: string): string {
  return `[GNUPG:] VALIDSIG ${fingerprint} 2026-08-06 0 0 4 0 1 10 00 ${fingerprint}`;
}

function replaceGpgProgram(repo: RepoFixture, output: string) {
  const program = join(repo.dir, "fake-gpg.sh");
  writeFileSync(
    program,
    [
      "#!/bin/sh",
      ...output.split("\n").map((line) => `printf '%s\\n' '${line}' >&2`),
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(program, 0o700);
  const result = git(repo, "config", "gpg.program", program);
  assert.equal(result.status, 0, result.stderr);
}

test("GPG primary signer succeeds", () => {
  const repo = makeSignedRepo(expectedKey.home, expectedKey.primary, "v1.2.3");
  const result = verify(repo, expectedKey.primary.toLowerCase());
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("GPG signing subkey resolves to expected primary signer", () => {
  const repo = makeSignedRepo(expectedKey.home, expectedKey.signing, "v1.2.3");
  const result = verify(repo, expectedKey.primary);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("protected workflow verifier accepts primary and signing-subkey tags", () => {
  for (const signer of [expectedKey.primary, expectedKey.signing]) {
    const repo = makeSignedRepo(expectedKey.home, signer, "v1.2.3");
    const result = runWorkflowTagVerifier(repo, expectedKey.primary);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test("valid signature from second imported key is rejected", () => {
  const home = mkdtempSync(join(tmpdir(), "planlet-release-gpg-two-"));
  tempDirs.push(home);
  importMaterial(home, expectedKey.publicKey + secondKey.privateKey);
  const repo = makeSignedRepo(home, secondKey.primary, "v1.2.3");
  const result = verify(repo, expectedKey.primary);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /primary fingerprint/i);
});

test("missing VALIDSIG status is rejected", () => {
  const repo = makeSignedRepo(expectedKey.home, expectedKey.primary, "v1.2.3");
  replaceGpgProgram(repo, "[GNUPG:] NEWSIG");
  const result = verify(repo, expectedKey.primary);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /exactly one VALIDSIG|verify-tag failed/);
});

test("multiple VALIDSIG statuses are rejected", () => {
  const repo = makeSignedRepo(expectedKey.home, expectedKey.primary, "v1.2.3");
  replaceGpgProgram(
    repo,
    `${validSigStatus(expectedKey.primary)}\n${validSigStatus(expectedKey.primary)}`,
  );
  const result = verify(repo, expectedKey.primary);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /exactly one VALIDSIG|verify-tag failed/);
});

test("malformed expected fingerprint is rejected", () => {
  for (const expectedFingerprint of ["not-a-fingerprint", undefined]) {
    const result = verifyReleaseTag({
      tag: "v1.2.3",
      target: "0".repeat(40),
      message: "Release v1.2.3",
      expectedFingerprint: expectedFingerprint as string,
      cwd: repoRoot,
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /40-character hexadecimal/);
  }
});

test("public-key setup rejects multiple primary public keys", () => {
  const home = mkdtempSync(join(tmpdir(), "planlet-release-gpg-public-two-"));
  tempDirs.push(home);
  const result = runSetup("Configure public-key verification", {
    ...workflowEnv(home),
    RELEASE_GPG_PUBLIC_KEY: expectedKey.publicKey + secondKey.publicKey,
    RELEASE_GPG_FINGERPRINT: expectedKey.primary,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one primary public key/);
});

test("private-key setup rejects multiple primary secret keys", () => {
  const home = mkdtempSync(join(tmpdir(), "planlet-release-gpg-secret-two-"));
  tempDirs.push(home);
  const result = runSetup("Configure private-key signing", {
    ...workflowEnv(home),
    RELEASE_GPG_PRIVATE_KEY: expectedKey.privateKey + secondKey.privateKey,
    RELEASE_GPG_PASSPHRASE: "",
    RELEASE_GPG_FINGERPRINT: expectedKey.primary,
    RELEASE_GIT_NAME: "Release Test",
    RELEASE_GIT_EMAIL: "release@example.test",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one primary secret key/);
});

test("existing-tag rerun imports no private key", () => {
  const home = mkdtempSync(join(tmpdir(), "planlet-release-gpg-public-only-"));
  tempDirs.push(home);
  const result = runSetup("Configure public-key verification", {
    ...workflowEnv(home),
    RELEASE_GPG_PUBLIC_KEY: expectedKey.publicKey,
    RELEASE_GPG_PRIVATE_KEY: "not imported on existing-tag rerun",
    RELEASE_GPG_FINGERPRINT: expectedKey.primary,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const secretKeys = gpg(home, "--with-colons", "--list-secret-keys");
  assert.equal(secretKeys.stdout.trim(), "");
});

test("newly created tag uses configured dedicated signing key", () => {
  const home = mkdtempSync(join(tmpdir(), "planlet-release-gpg-private-only-"));
  tempDirs.push(home);
  const repo = emptyRepo(home);
  const setup = runSetup(
    "Configure private-key signing",
    {
      ...workflowEnv(home),
      RELEASE_GPG_PRIVATE_KEY: expectedKey.privateKey,
      RELEASE_GPG_PASSPHRASE: "",
      RELEASE_GPG_FINGERPRINT: expectedKey.primary,
      RELEASE_GIT_NAME: "Release Test",
      RELEASE_GIT_EMAIL: "release@example.test",
    },
    repo.dir,
  );
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  writeFileSync(join(repo.dir, "content"), "release\n");
  const add = git(repo, "add", ".");
  assert.equal(add.status, 0, add.stderr);
  const commit = git(repo, "commit", "-q", "-m", "init");
  assert.equal(commit.status, 0, commit.stdout + commit.stderr);
  const tag = git(
    repo,
    "tag",
    "-a",
    "-s",
    "v1.2.3",
    "-m",
    "Release v1.2.3",
    "HEAD",
  );
  assert.equal(tag.status, 0, tag.stdout + tag.stderr);
  const target = git(repo, "rev-parse", "HEAD").stdout.trim();
  const verified = withGpgHome(home, () =>
    verifyReleaseTag({
      tag: "v1.2.3",
      target,
      message: "Release v1.2.3",
      expectedFingerprint: expectedKey.primary,
      cwd: repo.dir,
    }),
  );
  assert.equal(verified.ok, true, verified.ok ? "" : verified.error);
});

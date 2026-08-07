import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "release.yml");
const workflow = readFileSync(workflowPath, "utf8");
const releasing = readFileSync(join(repoRoot, "RELEASING.md"), "utf8");
const lines = workflow.split("\n");
const APP_TOKEN_ACTION =
  "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1";
const tempDirs: string[] = [];

test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function indexOfLine(predicate: (line: string) => boolean): number {
  return lines.findIndex(predicate);
}

function bashPath(path: string): string {
  if (process.platform !== "win32" || !/^[A-Za-z]:[\\/]/.test(path)) {
    return path;
  }
  return `/${path.slice(0, 1).toLowerCase()}${path.slice(2).replaceAll("\\", "/")}`;
}

function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  const result = spawnSync("where", ["bash"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split(/\r?\n/).find(Boolean)?.trim() ?? "bash";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function jobSection(name: string, next?: string): string {
  const start = indexOfLine((line) => line.trim() === name + ":");
  const end = next
    ? indexOfLine((line) => line.trim() === next + ":")
    : lines.length;
  assert.ok(start >= 0, `job ${name} missing`);
  return lines.slice(start, end).join("\n");
}

function stepSection(name: string): string {
  const start = indexOfLine((line) => line.includes(`- name: ${name}`));
  assert.ok(start >= 0, `step ${name} missing`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && /^\s+- name: /.test(line)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function shellBlock(name: string): string {
  const section = stepSection(name);
  const marker = "run: |";
  const markerIndex = section.indexOf(marker);
  assert.ok(markerIndex >= 0, `run block in ${name} missing`);
  const body = section.slice(section.indexOf("\n", markerIndex) + 1);
  return body
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .trim();
}

interface RenderedStep {
  readonly label: string;
  readonly script: string;
}

function stepSections(): Array<{
  readonly label: string;
  readonly section: string[];
}> {
  const result: Array<{ label: string; section: string[] }> = [];
  let start = -1;
  let label = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^ {6}- /.test(line)) {
      if (start >= 0) result.push({ label, section: lines.slice(start, i) });
      start = i;
      const m = /^\s+- (?:name|id):\s*(.*?)\s*$/.exec(line);
      label = m?.[1] ?? "";
    }
  }
  if (start >= 0) result.push({ label, section: lines.slice(start) });
  return result;
}

function renderRunBlock(section: readonly string[]): string | null {
  const runIdx = section.findIndex((line) => line.trim() === "run: |");
  if (runIdx < 0) return null;
  const body = section.slice(runIdx + 1);
  const first = body.find((line) => line.trim() !== "");
  if (!first) return "";
  const base = /^ */.exec(first)?.[0].length ?? 0;
  const out: string[] = [];
  for (const line of body) {
    if (line.trim() === "") {
      out.push("");
      continue;
    }
    if ((/^ */.exec(line)?.[0].length ?? 0) < base) break;
    out.push(line.slice(base));
  }
  return out.join("\n");
}

function bashSteps(): RenderedStep[] {
  const out: RenderedStep[] = [];
  for (const { label, section } of stepSections()) {
    if (!section.some((line) => /^\s+shell: bash\s*$/.test(line))) continue;
    const script = renderRunBlock(section);
    if (script === null) continue;
    out.push({ label, script });
  }
  return out;
}

function shellcheckAvailable(): boolean {
  const result = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
  return result.status === 0 && result.error === undefined;
}

function runGit(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

interface ProtectedContractOptions {
  readonly before?: string;
  readonly envVersion?: string;
  readonly packageName?: string;
  readonly lockName?: string;
  readonly packageVersion?: string;
  readonly lockVersion?: string;
  readonly rootVersion?: string;
  readonly missing?: string;
  readonly extra?: boolean;
}

function runProtectedContract(options: ProtectedContractOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "planlet-release-contract-"));
  tempDirs.push(dir);
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "test@example.test");
  runGit(dir, "config", "user.name", "test");

  const packageName = "@vipentti/planlet";
  const baseVersion = "1.1.0";
  const releaseVersion = "1.2.3";
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: packageName, version: baseVersion }, null, 2) + "\n",
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify(
      {
        name: packageName,
        version: baseVersion,
        lockfileVersion: 3,
        packages: { "": { name: packageName, version: baseVersion } },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n");
  runGit(dir, "add", ".");
  runGit(dir, "commit", "-q", "-m", "base");
  const before = runGit(dir, "rev-parse", "HEAD");

  const afterPackageName = options.packageName ?? packageName;
  const afterLockName = options.lockName ?? packageName;
  const afterPackageVersion = options.packageVersion ?? releaseVersion;
  const afterLockVersion = options.lockVersion ?? releaseVersion;
  const afterRootVersion = options.rootVersion ?? releaseVersion;
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: afterPackageName, version: afterPackageVersion },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify(
      {
        name: afterLockName,
        version: afterLockVersion,
        lockfileVersion: 3,
        packages: {
          "": { name: afterLockName, version: afterRootVersion },
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n\nrelease\n");
  if (options.extra) writeFileSync(join(dir, "extra.txt"), "unexpected\n");
  if (options.missing) unlinkSync(join(dir, options.missing));
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-q", "-m", "release");
  const after = runGit(dir, "rev-parse", "HEAD");

  const script = join(dir, "revalidate.mjs");
  writeFileSync(script, nodeBlock("Revalidate protected release contract"));
  return spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      BEFORE_SHA: options.before ?? before,
      GITHUB_SHA: after,
      VERSION: options.envVersion ?? releaseVersion,
    },
  });
}

function heredocBlocks(name: string): string[] {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.ok(start >= 0, `step ${name} missing`);
  const blocks: string[] = [];
  let search = start;
  while (true) {
    const heredoc = workflow.indexOf("<<'NODE'", search);
    if (heredoc < 0) break;
    const contentStart = workflow.indexOf("\n", heredoc) + 1;
    const terminator = /^[ \t]*NODE\s*$/m;
    const match = terminator.exec(workflow.slice(contentStart));
    if (!match) break;
    const codeEnd = contentStart + match.index;
    const code = workflow.slice(contentStart, codeEnd);
    const lines = code.split("\n");
    const nonEmpty = lines.filter((line) => line.trim() !== "");
    const indent = nonEmpty.reduce(
      (min, line) => Math.min(min, /^ */.exec(line)?.[0].length ?? 0),
      Infinity,
    );
    blocks.push(lines.map((line) => line.slice(indent)).join("\n"));
    search = codeEnd;
  }
  return blocks;
}

function nodeBlock(name: string): string {
  const blocks = heredocBlocks(name);
  const block = blocks[0];
  assert.ok(block !== undefined, `inline block in ${name} missing`);
  return block;
}

function nodeBlockContaining(name: string, marker: string): string {
  const block = heredocBlocks(name).find((code) => code.includes(marker));
  assert.ok(
    block !== undefined,
    `inline block containing ${marker} in ${name} missing`,
  );
  return block;
}

function runTagProbe(exitCode: number) {
  const dir = mkdtempSync(join(tmpdir(), "planlet-release-tag-probe-"));
  tempDirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const fakeGit = join(bin, "git");
  writeFileSync(
    fakeGit,
    `#!/bin/sh\nprintf 'probe diagnostic\\n' >&2\nexit ${exitCode}\n`,
  );
  chmodSync(fakeGit, 0o755);
  const output = join(dir, "output");
  writeFileSync(output, "");
  const script = join(dir, "probe.sh");
  writeFileSync(
    script,
    `git() { sh ${shellQuote(bashPath(fakeGit))} "$@"; }\n${shellBlock("Check remote release tag")}`,
  );
  return {
    result: spawnSync(bashExecutable(), [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: [bin, ...(process.env.PATH ?? "").split(delimiter)]
          .map(bashPath)
          .join(":"),
        VERSION: "1.2.3",
        GITHUB_OUTPUT: output,
      },
    }),
    output,
  };
}

test("workflow uses GitHub App credentials, not a push PAT", () => {
  assert.match(workflow, /RELEASE_APP_ID/);
  assert.match(workflow, /RELEASE_APP_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /RELEASE_PUSH_TOKEN/);
});

test("create-github-app-token is pinned and used exactly once in the protected job", () => {
  const uses =
    workflow.match(/uses: actions\/create-github-app-token@\S+/g) ?? [];
  assert.deepEqual(uses, [`uses: ${APP_TOKEN_ACTION}`]);
  assert.doesNotMatch(workflow, /actions\/create-github-app-token@v\d/);

  const envIdx = indexOfLine((line) => line.includes("environment: release"));
  const actionIdx = indexOfLine((line) => line.includes(APP_TOKEN_ACTION));
  assert.ok(envIdx >= 0, "protected environment missing");
  assert.ok(
    actionIdx > envIdx,
    "App-token step must live in the protected job",
  );
  assert.equal(
    workflow.match(/^\s+environment: release\s*$/gm)?.length,
    1,
    "only the release job may reference the protected environment",
  );
});

test("App token is scoped to planlet with Contents write only", () => {
  assert.match(workflow, /app-id: \$\{\{ vars\.RELEASE_APP_ID \}\}/);
  assert.match(
    workflow,
    /private-key: \$\{\{ secrets\.RELEASE_APP_PRIVATE_KEY \}\}/,
  );
  assert.match(workflow, /owner: \$\{\{ github\.repository_owner \}\}/);
  assert.match(workflow, /repositories: planlet/);
  assert.match(workflow, /permission-contents: write/);
});

test("App token is generated only when a tag push may be needed", () => {
  assert.match(
    workflow,
    /steps\.check-release-tag\.outputs\.tag-exists == 'false'/,
  );
  const tokenIdx = indexOfLine((line) =>
    line.includes("Generate GitHub App installation token"),
  );
  const checkIdx = indexOfLine((line) =>
    line.includes("Check remote release tag"),
  );
  assert.ok(checkIdx >= 0 && tokenIdx > checkIdx);
});

test("App token is consumed by the tag-push step and never persisted", () => {
  assert.match(
    workflow,
    /RELEASE_APP_TOKEN: \$\{\{ steps\.release-app-token\.outputs\.token \}\}/,
  );
  assert.match(workflow, /export GIT_CONFIG_COUNT=1/);
  assert.match(
    workflow,
    /export GIT_CONFIG_KEY_0=http\.https:\/\/github\.com\/\.extraheader/,
  );
  assert.match(workflow, /GIT_CONFIG_VALUE_0="AUTHORIZATION: basic \$auth"/);
  assert.match(
    workflow,
    /git push origin "refs\/tags\/\$\{tag\}:refs\/tags\/\$\{tag\}"/,
  );
  assert.doesNotMatch(workflow, /git -c [^\n]*RELEASE_APP_TOKEN/);

  for (const line of lines) {
    if (line.includes("RELEASE_APP_TOKEN")) {
      assert.doesNotMatch(line, /GITHUB_ENV|GITHUB_OUTPUT|::add-mask|echo /);
    }
  }

  const tagPushIdx = indexOfLine((line) =>
    line.includes(
      "RELEASE_APP_TOKEN: ${{ steps.release-app-token.outputs.token }}",
    ),
  );
  const publishIdx = indexOfLine((line) =>
    line.includes("Publish or verify existing package"),
  );
  const releaseIdx = indexOfLine((line) =>
    line.includes("Create or update GitHub release"),
  );
  assert.ok(tagPushIdx >= 0 && tagPushIdx < publishIdx);
  for (const line of lines.slice(publishIdx, releaseIdx)) {
    assert.doesNotMatch(line, /RELEASE_APP_TOKEN/);
  }
  for (const line of lines.slice(releaseIdx)) {
    assert.doesNotMatch(line, /RELEASE_APP_TOKEN/);
  }
});

test("remote tag probe distinguishes existing, absent, and error outcomes", () => {
  const existing = runTagProbe(0);
  assert.equal(existing.result.status, 0, existing.result.stderr);
  assert.equal(readFileSync(existing.output, "utf8").trim(), "tag-exists=true");

  const absent = runTagProbe(2);
  assert.equal(absent.result.status, 0, absent.result.stderr);
  assert.equal(readFileSync(absent.output, "utf8").trim(), "tag-exists=false");

  const error = runTagProbe(7);
  assert.notEqual(error.result.status, 0);
  assert.match(error.result.stderr, /probe diagnostic/);
  assert.match(error.result.stderr, /status 7/);
  assert.equal(readFileSync(error.output, "utf8"), "");
});

test("protected release revalidation accepts exact three-file release diff", () => {
  const result = runProtectedContract();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("protected release revalidation rejects changed-file and missing-file drift", () => {
  for (const options of [{ extra: true }, { missing: "CHANGELOG.md" }]) {
    const result = runProtectedContract(options);
    assert.notEqual(result.status, 0, result.stdout);
  }
});

test("protected release revalidation rejects malformed or unresolved BEFORE_SHA", () => {
  for (const before of ["not-a-sha", "0".repeat(40), "a".repeat(40)]) {
    const result = runProtectedContract({ before });
    assert.notEqual(result.status, 0, before);
  }
});

test("protected release revalidation rejects unstable or mismatched versions", () => {
  for (const envVersion of ["1.2.3-beta", "1.02.3", "1.2.3+build", "1.2.4"]) {
    const result = runProtectedContract({ envVersion });
    assert.notEqual(result.status, 0, envVersion);
  }
});

test("protected release revalidation rejects package and lockfile identity drift", () => {
  for (const options of [
    { packageName: "wrong" },
    { lockName: "wrong" },
    { packageVersion: "1.2.4" },
    { lockVersion: "1.2.4" },
    { rootVersion: "1.2.4" },
  ]) {
    const result = runProtectedContract(options);
    assert.notEqual(result.status, 0);
  }
});

test("workflow keeps safe ordering: verification before GPG and tag mutation", () => {
  const packIdx = indexOfLine((line) =>
    line.includes("Validate downloaded package artifact"),
  );
  const revalidateIdx = indexOfLine((line) =>
    line.includes("Revalidate protected release contract"),
  );
  const gpgIdx = indexOfLine((line) =>
    line.includes("Initialize isolated GPG home"),
  );
  const tokenIdx = indexOfLine((line) =>
    line.includes("Generate GitHub App installation token"),
  );
  const tagIdx = indexOfLine((line) =>
    line.includes("Ensure exact signed release tag"),
  );
  const verifyIdx = indexOfLine((line) =>
    line.includes("Verify GitHub reports the tag signature verified"),
  );
  const cleanupIdx = indexOfLine((line) =>
    line.includes("Clean up release GPG key material"),
  );
  assert.ok(
    packIdx >= 0 &&
      packIdx < revalidateIdx &&
      revalidateIdx < gpgIdx &&
      gpgIdx < tokenIdx &&
      tokenIdx < tagIdx &&
      tagIdx < verifyIdx &&
      verifyIdx < cleanupIdx,
  );
});

test("workflow contains no real credential material", () => {
  assert.doesNotMatch(workflow, /-----BEGIN (PGP|RSA|PRIVATE)/);
  assert.doesNotMatch(workflow, /ghp_[A-Za-z0-9]+/);
  assert.doesNotMatch(workflow, /github_pat_[A-Za-z0-9_]+/);
  assert.doesNotMatch(workflow, /RELEASE_APP_ID: \d+/);
});

test("package name is a trusted constant, never derived from package.json", () => {
  assert.match(workflow, /PACKAGE_NAME: ["']@vipentti\/planlet["']/);
  assert.doesNotMatch(workflow, /PACKAGE_NAME=.*node -p/);
  assert.doesNotMatch(workflow, /require\(['"]\.\/package\.json['"]\)\.name/);
});

test("protected job pins exact Node and bundled npm without installing anything", () => {
  const release = jobSection("release");
  assert.match(release, /node-version: "24\.11\.1"/);
  assert.match(release, /package-manager-cache: false/);
  assert.match(release, /test "\$\(node --version\)" = "v24\.11\.1"/);
  assert.match(release, /test "\$\(npm --version\)" = "11\.6\.2"/);
  assert.doesNotMatch(release, /npm install/);
  assert.doesNotMatch(release, /npx /);
  assert.doesNotMatch(release, /corepack/i);
});

test("verify job packs and uploads the artifact; release downloads instead of packing", () => {
  const verify = jobSection("verify", "release");
  const release = jobSection("release");
  assert.match(
    verify,
    /env:\n\s+VERSION: \$\{\{ needs\.detect\.outputs\.version \}\}/,
  );
  assert.match(verify, /Verify detected release version/);
  assert.match(verify, /stable X\.Y\.Z/);
  assert.match(verify, /npm pack --json --ignore-scripts/);
  assert.match(verify, /node --input-type=module <<'NODE'/);
  assert.doesNotMatch(verify, /package-filename=/);
  assert.doesNotMatch(verify, /package-integrity=/);
  assert.match(
    verify,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/,
  );
  assert.match(verify, /planlet-release-\$\{\{ github\.sha \}\}/);
  assert.match(verify, /if-no-files-found: error/);
  assert.match(verify, /smoke_dir="\$RUNNER_TEMP\/package-smoke"/);
  assert.doesNotMatch(verify, /RUNNER_TEMP\/pack\/smoke/);
  assert.match(
    verify,
    /path: \|\n\s+\$\{\{ runner\.temp \}\}\/pack\/vipentti-planlet-\$\{\{ needs\.detect\.outputs\.version \}\}\.tgz\n\s+\$\{\{ runner\.temp \}\}\/pack\/pack\.json/,
  );
  assert.match(verify, /retention-days: 30/);
  assert.match(
    release,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/,
  );
  assert.match(release, /planlet-release-\$\{\{ github\.sha \}\}/);
  assert.match(release, /PACKAGE_SHA256/);
  assert.match(release, /PACKAGE_TARBALL=\$\{tarball\}\\n/);
  assert.doesNotMatch(release, /npm pack/);
  assert.doesNotMatch(release, /validate-packed-artifact\.mjs/);
});

test("release validates the downloaded artifact before any mutation", () => {
  const release = jobSection("release");
  assert.match(
    release,
    /downloaded tarball SHA-256 does not match verified output/,
  );
  assert.match(release, /npm integrity does not match downloaded tarball/);
  assert.match(release, /must contain a non-empty package\/dist\/planlet\.mjs/);
  const downloadIdx = indexOfLine((line) =>
    line.includes("Validate downloaded package artifact"),
  );
  const tagCheckIdx = indexOfLine((line) =>
    line.includes("Check remote release tag"),
  );
  const gpgIdx = indexOfLine((line) =>
    line.includes("Initialize isolated GPG home"),
  );
  const tokenIdx = indexOfLine((line) =>
    line.includes("Generate GitHub App installation token"),
  );
  const tagIdx = indexOfLine((line) =>
    line.includes("Ensure exact signed release tag"),
  );
  assert.ok(
    downloadIdx >= 0 &&
      tagCheckIdx >= 0 &&
      tagCheckIdx < downloadIdx &&
      downloadIdx < gpgIdx &&
      gpgIdx < tokenIdx &&
      tokenIdx < tagIdx,
  );
});

test("release-intent guards run before tag creation for new-tag runs", () => {
  const release = jobSection("release");
  assert.match(release, /Verify release intent is unchanged/);
  assert.match(release, /Verify release intent is still current/);
  assert.match(
    release,
    /git diff --quiet "\$GITHUB_SHA"\.\.origin\/main -- CHANGELOG\.md package\.json package-lock\.json/,
  );
  const earlyIdx = indexOfLine((line) =>
    line.includes("Verify release intent is unchanged"),
  );
  const finalIdx = indexOfLine((line) =>
    line.includes("Verify release intent is still current"),
  );
  const tagIdx = indexOfLine((line) =>
    line.includes("Ensure exact signed release tag"),
  );
  assert.ok(earlyIdx >= 0 && earlyIdx < finalIdx && finalIdx < tagIdx);
});

test("final intent check precedes App-token generation and tag creation immediately follows", () => {
  const revalidate = stepSection("Revalidate protected release contract");
  assert.match(revalidate, /BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(revalidate, /BEFORE_SHA must be lowercase 40-hex/);
  assert.match(revalidate, /BEFORE_SHA must not be all zeroes/);
  assert.match(revalidate, /checked-out HEAD must equal GITHUB_SHA/);
  assert.match(revalidate, /stable X\.Y\.Z/);
  assert.match(revalidate, /package-lock root name mismatch/);
  assert.match(revalidate, /package-lock root version mismatch/);
  assert.match(revalidate, /exactly the three release files/);
  assert.match(revalidate, /duplicate paths/);

  const finalIdx = indexOfLine((line) =>
    line.includes("Verify release intent is still current"),
  );
  const tokenNameIdx = indexOfLine((line) =>
    line.includes("Generate GitHub App installation token"),
  );
  const tokenActionIdx = indexOfLine((line) => line.includes(APP_TOKEN_ACTION));
  const tagIdx = indexOfLine((line) =>
    line.includes("Ensure exact signed release tag"),
  );
  assert.ok(finalIdx >= 0 && finalIdx < tokenNameIdx);
  assert.ok(tokenActionIdx > tokenNameIdx && tokenActionIdx < tagIdx);
  assert.doesNotMatch(
    lines.slice(tokenActionIdx + 1, tagIdx).join("\n"),
    /^\s+- name:/m,
  );
});

test("protected job executes no repository-owned scripts", () => {
  const release = jobSection("release");
  assert.doesNotMatch(release, /node scripts\//);
  assert.doesNotMatch(release, /bash scripts\//);
  assert.doesNotMatch(release, /sh scripts\//);
  assert.doesNotMatch(release, /\.\/scripts\//);
  assert.doesNotMatch(release, /npm run/);
  assert.doesNotMatch(release, /node dist\//);
});

test("tag verification is inline git built-ins with all five assertions", () => {
  const release = jobSection("release");
  assert.match(release, /git cat-file -t "refs\/tags\/\$\{t\}"/);
  assert.match(
    release,
    /git rev-parse --verify "refs\/tags\/\$\{t\}\^\{commit\}"/,
  );
  assert.match(release, /git tag -l ['"]?--format=%\(contents:subject\)/);
  assert.match(release, /git verify-tag --raw "\$\{t\}"/);
  assert.match(
    release,
    /RELEASE_GPG_FINGERPRINT: \$\{\{ vars\.RELEASE_GPG_FINGERPRINT \}\}/,
  );
  assert.match(release, /Expected exactly one valid GPG signature/);
  assert.match(release, /primary fingerprint/);
  assert.match(release, /tr -cd '0-9a-f'/);
  assert.doesNotMatch(release, /node scripts\/verify-release-tag\.mjs/);
});

test("npm publish disables lifecycle scripts and pins the registry", () => {
  const release = jobSection("release");
  assert.match(
    release,
    /npm publish "\$PACKAGE_TARBALL" --ignore-scripts --access public --provenance --registry=https:\/\/registry\.npmjs\.org/,
  );
  assert.match(
    release,
    /npm view "\$spec" --json --registry=https:\/\/registry\.npmjs\.org/,
  );
  assert.match(release, /Waiting for registry visibility/);
  assert.match(release, /registry\.name, source\.name/);
  assert.match(release, /registry\.version, source\.version/);
  assert.match(release, /registry\.repository\?\.url, source\.repository\.url/);
  assert.match(release, /registry\.gitHead, process\.env\.GITHUB_SHA/);
  assert.match(release, /registry\.dist\?\.integrity, packed\.integrity/);
});

test("npm publish refuses a version below an already-published newer version", () => {
  const release = jobSection("release");
  assert.match(
    release,
    /npm view "\$\{PACKAGE_NAME\}" versions --json --registry=https:\/\/registry\.npmjs\.org/,
  );
  assert.match(release, /refusing to publish/);
});

test("registry guard fails closed on unexpected published versions JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "planlet-registry-guard-"));
  tempDirs.push(dir);
  const script = join(dir, "guard.mjs");
  writeFileSync(
    script,
    nodeBlockContaining("Publish or verify existing package", "published.json"),
  );

  const cases: Array<{ fixture: string; version: string; expectOk: boolean }> =
    [
      // Array with a newer stable version refuses.
      {
        fixture: '["0.1.0","0.2.0","0.3.5"]',
        version: "0.3.0",
        expectOk: false,
      },
      // Singleton string with a newer stable version refuses.
      { fixture: '"0.3.5"', version: "0.3.0", expectOk: false },
      // Unexpected successful object shape fails closed.
      { fixture: '{"version":"0.3.5"}', version: "0.3.0", expectOk: false },
      // Array with no newer stable version proceeds.
      { fixture: '["0.1.0","0.2.0"]', version: "0.3.0", expectOk: true },
      // Prerelease-only newer values stay ignored.
      { fixture: '["0.3.0-rc.1"]', version: "0.3.0", expectOk: true },
    ];

  for (const c of cases) {
    writeFileSync(join(dir, "published.json"), c.fixture);
    const result = spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, VERSION: c.version },
    });
    assert.equal(
      result.status === 0,
      c.expectOk,
      `fixture ${c.fixture}: ${result.stderr || result.stdout}`,
    );
  }
});

test("every shell:bash step renders a script that passes bash -n", () => {
  const steps = bashSteps();
  assert.ok(steps.length > 0, "no shell:bash steps found in workflow");
  for (const step of steps) {
    const dir = mkdtempSync(join(tmpdir(), "planlet-bash-n-"));
    tempDirs.push(dir);
    const script = join(dir, "step.sh");
    writeFileSync(script, `#!/usr/bin/env bash\n${step.script}\n`);
    const result = spawnSync(bashExecutable(), ["-n", script], {
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `${step.label}: bash -n failed:\n${result.stderr}`,
    );
  }
});

test("every shell:bash step renders a script that passes shellcheck when available", (t) => {
  if (!shellcheckAvailable()) {
    t.skip("shellcheck not installed; skipping rendered-script lint");
    return;
  }
  const steps = bashSteps();
  assert.ok(steps.length > 0, "no shell:bash steps found in workflow");
  for (const step of steps) {
    const dir = mkdtempSync(join(tmpdir(), "planlet-shellcheck-"));
    tempDirs.push(dir);
    const script = join(dir, "step.sh");
    const substituted = step.script.replace(
      /\$\{\{[^}]*\}\}/g,
      "${GITHUB_TEMPLATE:-}",
    );
    writeFileSync(script, `#!/usr/bin/env bash\n${substituted}\n`);
    const result = spawnSync("shellcheck", ["-e", "SC2015", script], {
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `${step.label}: shellcheck failed:\n${result.stdout}${result.stderr}`,
    );
  }
});

test("versions-guard heredoc terminates at column 0 after YAML de-indent", () => {
  const publish = bashSteps().find(
    (step) => step.label === "Publish or verify existing package",
  );
  assert.ok(publish !== undefined, "publish step missing");
  const guards = [
    ...publish.script.matchAll(
      /node --input-type=module <<'NODE'\n([\s\S]*?)\n( *)NODE/g,
    ),
  ];
  const guard = guards.find((m) =>
    (m[1] ?? "").includes("refusing to publish"),
  );
  assert.ok(
    guard !== undefined,
    "versions-guard heredoc missing from rendered script",
  );
  assert.equal(
    guard[2] ?? "",
    "",
    "versions-guard NODE terminator must be at column 0",
  );
});

test("registry verifier reads pack.json from downloaded artifact directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "planlet-registry-verify-"));
  tempDirs.push(dir);
  const artifactDir = join(dir, "artifact");
  mkdirSync(artifactDir);
  const integrity = "sha512-test-integrity";
  const version = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ).version as string;
  writeFileSync(
    join(artifactDir, "pack.json"),
    JSON.stringify([
      { filename: `vipentti-planlet-${version}.tgz`, integrity },
    ]),
  );
  writeFileSync(
    join(dir, "registry.json"),
    JSON.stringify({
      name: "@vipentti/planlet",
      version,
      repository: { url: "git+https://github.com/vipentti/planlet.git" },
      dist: { integrity, tarball: "https://registry.test/planlet.tgz" },
    }),
  );
  const script = join(dir, "verify.mjs");
  writeFileSync(script, nodeBlock("Publish or verify existing package"));
  const result = spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      GITHUB_WORKSPACE: repoRoot,
      GITHUB_SHA: "test-sha",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes(`Verified @vipentti/planlet@${version}`),
    result.stdout,
  );
});

test("downloaded artifact validation is order-independent over directory listing", () => {
  const dir = mkdtempSync(join(tmpdir(), "planlet-artifact-order-"));
  tempDirs.push(dir);
  const artifactDir = join(dir, "artifact");
  mkdirSync(artifactDir);
  const version = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ).version as string;
  const expected = `vipentti-planlet-${version}.tgz`;

  const staging = join(dir, "staging");
  mkdirSync(join(staging, "package", "dist"), { recursive: true });
  writeFileSync(
    join(staging, "package", "package.json"),
    JSON.stringify({
      name: "@vipentti/planlet",
      version,
      bin: { planlet: "dist/planlet.mjs" },
    }),
  );
  writeFileSync(
    join(staging, "package", "dist", "planlet.mjs"),
    "// planlet\n",
  );
  writeFileSync(
    join(artifactDir, "pack.json"),
    JSON.stringify([{ filename: expected, integrity: "sha512-pending" }]),
  );
  const tarball = join(artifactDir, expected);
  const packed = spawnSync("tar", ["-czf", tarball, "-C", staging, "package"], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const bytes = readFileSync(tarball);
  const integrity =
    "sha512-" + createHash("sha512").update(bytes).digest("base64");
  writeFileSync(
    join(artifactDir, "pack.json"),
    JSON.stringify([{ filename: expected, integrity }]),
  );

  const script = join(dir, "validate.mjs");
  writeFileSync(script, nodeBlock("Validate downloaded package artifact"));
  const result = spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      VERSION: version,
      PACKAGE_SHA256: createHash("sha256").update(bytes).digest("hex"),
      GITHUB_ENV: join(dir, "github-env.txt"),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(join(dir, "github-env.txt"), "utf8"),
    /PACKAGE_TARBALL=/,
  );
});

test("release-notes extraction writes notes for the release version", () => {
  const dir = mkdtempSync(join(tmpdir(), "planlet-release-notes-"));
  tempDirs.push(dir);
  const version = "1.2.3";
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      `## [${version}] - 2026-08-07`,
      "",
      "### Added",
      "",
      "- some feature",
      "",
      `[Unreleased]: https://example.test/compare/v1.1.0...HEAD`,
      `[${version}]: https://example.test/compare/v1.1.0...v${version}`,
      "",
    ].join("\n"),
  );
  const script = join(dir, "notes.mjs");
  writeFileSync(script, nodeBlock("Extract release notes"));
  const result = spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, VERSION: version, RUNNER_TEMP: dir },
  });
  assert.equal(result.status, 0, result.stderr);
  const notes = readFileSync(join(dir, "release-notes.md"), "utf8");
  assert.match(notes, /### Added/);
  assert.match(notes, /- some feature/);
});

test("reviewed package artifact validation executes against a packed fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "planlet-pack-review-"));
  tempDirs.push(dir);
  const packDir = join(dir, "pack");
  mkdirSync(packDir);
  const version = "1.2.3";
  const expected = `vipentti-planlet-${version}.tgz`;

  const staging = join(dir, "staging");
  mkdirSync(join(staging, "package", "dist"), { recursive: true });
  writeFileSync(
    join(staging, "package", "package.json"),
    JSON.stringify({
      name: "@vipentti/planlet",
      version,
      bin: { planlet: "dist/planlet.mjs" },
    }),
  );
  writeFileSync(
    join(staging, "package", "dist", "planlet.mjs"),
    "// planlet\n",
  );
  const tarball = join(packDir, expected);
  const packed = spawnSync("tar", ["-czf", tarball, "-C", staging, "package"], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const bytes = readFileSync(tarball);
  const integrity =
    "sha512-" + createHash("sha512").update(bytes).digest("base64");
  writeFileSync(
    join(packDir, "pack.json"),
    JSON.stringify([{ filename: expected, integrity }]),
  );
  const output = join(dir, "github-output.txt");
  writeFileSync(output, "");

  const script = join(dir, "validate.mjs");
  writeFileSync(script, nodeBlock("Validate reviewed package artifact"));
  const result = spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      VERSION: version,
      GITHUB_OUTPUT: output,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, "utf8"), /package-sha256=[0-9a-f]{64}/);
});

test("every inline node heredoc in a shell:bash step is behaviorally covered", () => {
  const covered = new Set([
    "Extract release notes",
    "Validate reviewed package artifact",
    "Validate downloaded package artifact",
    "Revalidate protected release contract",
    "Publish or verify existing package",
  ]);
  const withHeredoc = bashSteps().filter((step) =>
    step.script.includes("node --input-type=module <<'NODE'"),
  );
  assert.ok(withHeredoc.length > 0, "no inline node heredocs found");
  for (const step of withHeredoc) {
    assert.ok(
      covered.has(step.label),
      `${step.label} has an inline node heredoc without behavioral coverage`,
    );
  }
});

test("public GPG key is documented and referenced in the protected job", () => {
  assert.match(
    workflow,
    /RELEASE_GPG_PUBLIC_KEY: \$\{\{ secrets\.RELEASE_GPG_PUBLIC_KEY \}\}/,
  );
  assert.match(releasing, /RELEASE_GPG_PUBLIC_KEY/);
});

test("GPG setup is split by execution path", () => {
  const publicStep = stepSection("Configure public-key verification");
  const privateStep = stepSection("Configure private-key signing");
  const initStep = stepSection("Initialize isolated GPG home");

  assert.match(
    publicStep,
    /if: steps\.check-release-tag\.outputs\.tag-exists == 'true'/,
  );
  assert.match(
    privateStep,
    /if: steps\.check-release-tag\.outputs\.tag-exists == 'false'/,
  );

  // Existing-tag path: public key only, no secret material or signing wrapper.
  assert.doesNotMatch(
    publicStep,
    /RELEASE_GPG_PRIVATE_KEY|RELEASE_GPG_PASSPHRASE|gpg-wrapper|passphrase file/,
  );
  assert.match(publicStep, /--list-secret-keys/);

  // New-tag path retains the hardened signing setup.
  assert.match(privateStep, /RELEASE_GPG_PRIVATE_KEY/);
  assert.match(privateStep, /RELEASE_GPG_PASSPHRASE/);
  assert.match(privateStep, /passphrase/);
  assert.match(privateStep, /gpg-wrapper\.sh/);
  assert.match(privateStep, /RELEASE_GPG_FINGERPRINT/);
  assert.match(publicStep, /RELEASE_GPG_FINGERPRINT/);

  assert.match(initStep, /mktemp -d/);
  assert.match(initStep, /chmod 700/);
  assert.doesNotMatch(
    initStep,
    /RELEASE_GPG_PRIVATE_KEY|RELEASE_GPG_PUBLIC_KEY|PASSPHRASE/,
  );
  assert.match(
    stepSection("Clean up release GPG key material"),
    /if: always\(\)/,
  );
});

test("GPG setup counts primary keys without counting subkeys", () => {
  const publicStep = stepSection("Configure public-key verification");
  const privateStep = stepSection("Configure private-key signing");
  assert.match(publicStep, /primary_public_count/);
  assert.match(publicStep, /\$1 == "pub"/);
  assert.match(publicStep, /\$1 == "fpr"/);
  assert.match(privateStep, /primary_secret_count/);
  assert.match(privateStep, /\$1 == "sec"/);
  assert.match(privateStep, /\$1 == "fpr"/);
  assert.doesNotMatch(privateStep, /\$1 == "ssb"/);
});

test("exact tag signer validation is fail-closed and case-normalized", () => {
  const release = jobSection("release");
  assert.match(release, /\^\[0-9A-Fa-f\]\{40\}\$/);
  assert.match(release, /valid_count=.*valid_fingerprints/s);
  assert.match(release, /awk 'NF \{ count\+\+ \}/);
  assert.match(release, /\$2 == "VALIDSIG"/);
  assert.match(release, /primary=\$12/);
  assert.match(release, /tr '\[:lower:\]' '\[:upper:\]'/);
  assert.match(release, /test "\$valid_count" -eq 1/);
  assert.match(release, /git verify-tag --raw/);
});

test("Required reviewer Environment rule is documented as mandatory", () => {
  assert.match(workflow, /does not itself require approval/);
  assert.match(workflow, /Required reviewer/);
  assert.match(releasing, /does not itself require\s+approval/);
  assert.match(releasing, /Required reviewer/);
});

test("duplicate protected-job changelog verification is removed", () => {
  assert.doesNotMatch(workflow, /Verify committed changelog release state/);
  // The detector still performs historical changelog validation.
  assert.match(workflow, /scripts\/detect-release-merge\.mjs/);
});

test("workflow-level permissions do not grant id-token", () => {
  const top = lines
    .slice(
      0,
      indexOfLine((line) => line.trim() === "detect:"),
    )
    .join("\n");
  assert.match(top, /permissions:/);
  assert.match(top, /contents: read/);
  assert.doesNotMatch(top, /id-token/);
});

test("detect job is unprivileged and holds no release material", () => {
  const detect = jobSection("detect", "verify");
  assert.doesNotMatch(detect, /id-token/);
  assert.doesNotMatch(detect, /environment: release/);
  assert.match(detect, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.doesNotMatch(detect, /--after/);
  assert.match(detect, /BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(detect, /--before "\$BEFORE_SHA"/);
  assert.doesNotMatch(detect, /--before "\$\{\{ github\.event\.before \}\}"/);
  assert.doesNotMatch(
    detect,
    /RELEASE_APP_ID|RELEASE_APP_PRIVATE_KEY|RELEASE_GPG|PACKAGE_NAME/,
  );
});

test("verify job is unprivileged and runs the full verification chain", () => {
  const verify = jobSection("verify", "release");
  assert.match(verify, /contents: read/);
  assert.doesNotMatch(verify, /id-token/);
  assert.doesNotMatch(verify, /environment: release/);
  assert.match(verify, /npm ci/);
  assert.match(verify, /npm run format:check/);
  assert.match(verify, /npm run lint/);
  assert.match(verify, /npm run type-check/);
  assert.match(verify, /npm run build/);
  assert.match(verify, /npm test/);
  assert.match(verify, /git diff --check/);
  assert.match(verify, /Verify generated skills/);
  assert.match(verify, /Verify clean tagged source/);
  assert.match(verify, /merge-base --is-ancestor/);
  assert.doesNotMatch(
    verify,
    /RELEASE_APP_ID|RELEASE_APP_PRIVATE_KEY|RELEASE_GPG|RELEASE_PUSH_TOKEN/,
  );
});

test("only the protected release job has id-token and runs no dependency code", () => {
  const release = jobSection("release");
  assert.match(release, /environment: release/);
  assert.match(release, /contents: write/);
  assert.match(release, /id-token: write/);
  assert.match(release, /needs: \[detect, verify\]/);
  assert.match(release, /merge-base --is-ancestor/);
  assert.match(
    release,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/,
  );
  assert.doesNotMatch(release, /npm pack/);
  assert.match(release, /appendFileSync\(process\.env\.GITHUB_ENV/);
  assert.doesNotMatch(release, /npm ci/);
  assert.doesNotMatch(release, /npm install(?! --global npm@11\.5\.1)/);
  assert.doesNotMatch(release, /npm run build/);
  assert.doesNotMatch(release, /npm run lint/);
  assert.doesNotMatch(release, /npm run type-check/);
  assert.doesNotMatch(release, /npm test/);
});

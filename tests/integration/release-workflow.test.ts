import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "release.yml");
const workflow = readFileSync(workflowPath, "utf8");
const releasing = readFileSync(join(repoRoot, "RELEASING.md"), "utf8");
const lines = workflow.split("\n");
const APP_TOKEN_ACTION =
  "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1";

function indexOfLine(predicate: (line: string) => boolean): number {
  return lines.findIndex(predicate);
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
  assert.match(workflow, /x-access-token:%s' "\$RELEASE_APP_TOKEN"/);

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

test("workflow keeps safe ordering: verification before GPG and tag mutation", () => {
  const packIdx = indexOfLine((line) =>
    line.includes("Validate downloaded package artifact"),
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
      packIdx < gpgIdx &&
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
  assert.match(verify, /npm pack --json --ignore-scripts/);
  assert.match(verify, /node --input-type=module <<'NODE'/);
  assert.match(verify, /package-filename=\$\{packed\.filename\}/);
  assert.match(
    verify,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/,
  );
  assert.match(verify, /planlet-release-\$\{\{ github\.sha \}\}/);
  assert.match(verify, /if-no-files-found: error/);
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
  assert.match(release, /git tag -l --format=%\(contents:subject\)/);
  assert.match(release, /git verify-tag "\$\{t\}"/);
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

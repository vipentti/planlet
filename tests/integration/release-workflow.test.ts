import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "release.yml");
const workflow = readFileSync(workflowPath, "utf8");
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
    line.includes("Build reviewed package artifact"),
  );
  const gpgIdx = indexOfLine((line) => line.includes("Configure GPG signing"));
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

test("packed artifact validation is inline and writes env only after success", () => {
  const release = jobSection("release");
  assert.match(release, /npm pack --json --ignore-scripts/);
  assert.match(release, /node --input-type=module <<'NODE'/);
  assert.match(release, /PACKAGE_TARBALL=\$\{tarball\}\\n/);
  assert.doesNotMatch(release, /validate-packed-artifact\.mjs/);
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
  assert.match(release, /npm pack --json --ignore-scripts/);
  assert.match(release, /appendFileSync\(process\.env\.GITHUB_ENV/);
  assert.doesNotMatch(release, /npm ci/);
  assert.doesNotMatch(release, /npm install(?! --global npm@11\.5\.1)/);
  assert.doesNotMatch(release, /npm run build/);
  assert.doesNotMatch(release, /npm run lint/);
  assert.doesNotMatch(release, /npm run type-check/);
  assert.doesNotMatch(release, /npm test/);
});

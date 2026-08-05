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

// Declaration bridge for the strict TypeScript test suite, which imports the
// .mjs module while JS files themselves are not type-checked. Kept narrow:
// types mirror verify-release-tag.mjs; do not remove it as a line-count cut
// unless a smaller solution preserves strict typing without allowJs/checkJs
// expansion, new dependencies, or reduced strictness.

export interface VerifyReleaseTagSuccess {
  ok: true;
  objectSha: string;
}

export interface VerifyReleaseTagFailure {
  ok: false;
  error: string;
}

export type VerifyReleaseTagResult =
  VerifyReleaseTagSuccess | VerifyReleaseTagFailure;

export function verifyReleaseTag(options: {
  tag: string;
  target: string;
  message: string;
  expectedFingerprint: string;
  cwd?: string;
}): VerifyReleaseTagResult;

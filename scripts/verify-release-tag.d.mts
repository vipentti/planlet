export interface VerifyReleaseTagSuccess {
  ok: true;
  objectSha: string;
}

export interface VerifyReleaseTagFailure {
  ok: false;
  error: string;
}

export type VerifyReleaseTagResult =
  | VerifyReleaseTagSuccess
  | VerifyReleaseTagFailure;

export function verifyReleaseTag(options: {
  tag: string;
  target: string;
  message: string;
  cwd?: string;
}): VerifyReleaseTagResult;

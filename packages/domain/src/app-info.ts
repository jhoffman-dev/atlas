/** Application identity: shown in the about box and attached to bug reports. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
  /** The commit the build was made from, as a short SHA; null when the build did not know it. */
  readonly build: string | null;
}

export class InvalidAppInfoError extends Error {
  constructor(reason: string) {
    super(`Invalid app info: ${reason}`);
    this.name = 'InvalidAppInfoError';
  }
}

/** Semver, optionally pre-release. Leading zeros are rejected, as the spec requires. */
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A git commit id, abbreviated or whole, as `git rev-parse` prints it. */
const COMMIT = /^[0-9a-f]{7,40}$/;

export function createAppInfo({
  name,
  version,
  build,
}: {
  name: string;
  version: string;
  build?: string | null;
}): AppInfo {
  const trimmedName = name.trim();
  if (trimmedName === '') throw new InvalidAppInfoError('name is empty');
  if (!SEMVER.test(version)) throw new InvalidAppInfoError(`version "${version}" is not semver`);
  const commit = build?.trim() ?? '';
  if (commit !== '' && !COMMIT.test(commit)) {
    throw new InvalidAppInfoError(`build "${commit}" is not a commit id`);
  }
  return { name: trimmedName, version, build: commit === '' ? null : commit };
}

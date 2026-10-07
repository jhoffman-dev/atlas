/** Application identity: shown in the about box and attached to bug reports. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
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

export function createAppInfo({ name, version }: { name: string; version: string }): AppInfo {
  const trimmedName = name.trim();
  if (trimmedName === '') throw new InvalidAppInfoError('name is empty');
  if (!SEMVER.test(version)) throw new InvalidAppInfoError(`version "${version}" is not semver`);
  return { name: trimmedName, version };
}

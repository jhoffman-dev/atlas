import { describe, expect, it } from 'vitest';
import {
  InvalidVersionError,
  cargoCrateName,
  disagreements,
  nextVersion,
  readVersion,
  tagMismatch,
  writeVersion,
  type VersionFile,
} from './versions.ts';

const packageJson = (version: string) =>
  `{\n  "name": "@atlas/domain",\n  "version": "${version}",\n  "private": true,\n  "dependencies": {\n    "left-pad": "1.3.0"\n  }\n}\n`;

const tauriConf = (version: string) =>
  `{\n  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",\n  "productName": "Atlas",\n  "version": "${version}",\n  "identifier": "dev.example.atlas"\n}\n`;

const cargoToml = (version: string) =>
  `[package]\nname = "atlas"\nversion = "${version}"\nrust-version = "1.77.2"\n\n[dependencies]\ntauri = { version = "2.11.3", features = [] }\n`;

const cargoLock = (version: string) =>
  `version = 4\n\n[[package]]\nname = "anyhow"\nversion = "1.0.98"\n\n[[package]]\nname = "atlas"\nversion = "${version}"\ndependencies = [\n "anyhow",\n]\n\n[[package]]\nname = "atlas-helper"\nversion = "9.9.9"\n`;

const files = (version: string): VersionFile[] => [
  { path: 'package.json', kind: 'package-json', text: packageJson(version) },
  { path: 'apps/desktop/src-tauri/tauri.conf.json', kind: 'tauri-conf', text: tauriConf(version) },
  { path: 'apps/desktop/src-tauri/Cargo.toml', kind: 'cargo-toml', text: cargoToml(version) },
  { path: 'apps/desktop/src-tauri/Cargo.lock', kind: 'cargo-lock', text: cargoLock(version) },
];

const CRATE = 'atlas';

describe('the next version', () => {
  it.each([
    ['0.1.0', 'patch', '0.1.1'],
    ['0.1.9', 'minor', '0.2.0'],
    ['0.9.4', 'major', '1.0.0'],
    ['1.2.3', 'major', '2.0.0'],
  ])('bumps %s by %s to %s', (current, request, expected) => {
    expect(nextVersion(current, request)).toBe(expected);
  });

  it.each([['0.2.0'], ['1.0.0-beta.1'], ['10.20.30']])('is %s when asked for exactly that', (v) => {
    expect(nextVersion('0.1.0', v)).toBe(v);
  });

  it.each([['v0.2.0'], ['0.2'], ['01.2.3'], ['0.2.0.1'], ['banana'], ['']])(
    'refuses %j, which is neither semver nor a bump',
    (request) => {
      expect(() => nextVersion('0.1.0', request)).toThrow(InvalidVersionError);
    },
  );

  it('refuses to bump a pre-release, which has no one obvious next version', () => {
    expect(() => nextVersion('1.0.0-beta.1', 'patch')).toThrow(/pre-release/);
  });

  it('refuses to bump from a current version that is not semver', () => {
    expect(() => nextVersion('0.1', 'patch')).toThrow(InvalidVersionError);
  });

  it('refuses to go backwards or stand still', () => {
    expect(() => nextVersion('0.2.0', '0.1.9')).toThrow(/after 0\.2\.0/);
    expect(() => nextVersion('0.2.0', '0.2.0')).toThrow(/after 0\.2\.0/);
  });

  it.each([
    ['1.0.0-rc.2', '1.0.0-rc.10'],
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-beta'],
    ['1.0.0-1', '1.0.0-alpha'],
  ])('takes %s to the later pre-release %s, in semver order', (current, request) => {
    expect(nextVersion(current, request)).toBe(request);
    expect(() => nextVersion(request, current)).toThrow(/does not come after/);
  });

  it('refuses a pre-release of the version it is already at', () => {
    expect(() => nextVersion('1.0.0', '1.0.0-rc.1')).toThrow(/does not come after/);
  });

  it('takes a release after its own pre-release', () => {
    expect(nextVersion('1.0.0-rc.1', '1.0.0')).toBe('1.0.0');
  });
});

describe('reading a version', () => {
  it.each(files('0.4.2'))('reads it from $path', (file) => {
    expect(readVersion(file, CRATE)).toBe('0.4.2');
  });

  it('reads the crate in Cargo.lock by its name, not the first package listed', () => {
    const lock = files('0.4.2')[3]!;
    expect(readVersion(lock, 'atlas-helper')).toBe('9.9.9');
  });

  it('says which file has no version', () => {
    const file: VersionFile = {
      path: 'packages/ui/package.json',
      kind: 'package-json',
      text: '{}',
    };
    expect(() => readVersion(file, CRATE)).toThrow(/packages\/ui\/package\.json/);
  });

  it('says which Cargo.lock does not list the crate', () => {
    const lock = files('0.4.2')[3]!;
    expect(() => readVersion(lock, 'missing')).toThrow(/Cargo\.lock.*missing/);
  });

  it('reads only the [package] section of Cargo.toml, not a dependency', () => {
    const file: VersionFile = {
      path: 'Cargo.toml',
      kind: 'cargo-toml',
      text: '[dependencies]\nversion = "7.7.7"\n\n[package]\nname = "atlas"\nversion = "0.3.0"\n',
    };
    expect(readVersion(file, CRATE)).toBe('0.3.0');
  });

  it('says which Cargo.toml has no [package] version', () => {
    const file: VersionFile = { path: 'Cargo.toml', kind: 'cargo-toml', text: '[workspace]\n' };
    expect(() => readVersion(file, CRATE)).toThrow(/Cargo\.toml/);
  });
});

describe('writing a version', () => {
  it.each(files('0.1.0'))('changes only the version in $path', (file) => {
    const written = writeVersion(file, '0.2.0', CRATE);
    expect(readVersion({ ...file, text: written }, CRATE)).toBe('0.2.0');
    const expected = files('0.2.0').find((other) => other.path === file.path)!;
    expect(written).toBe(expected.text);
  });

  it('leaves the dependency versions in Cargo.toml and Cargo.lock alone', () => {
    const [, , toml, lock] = files('0.1.0');
    expect(writeVersion(toml!, '0.2.0', CRATE)).toContain('tauri = { version = "2.11.3"');
    const writtenLock = writeVersion(lock!, '0.2.0', CRATE);
    expect(writtenLock).toContain('name = "anyhow"\nversion = "1.0.98"');
    expect(writtenLock).toContain('name = "atlas-helper"\nversion = "9.9.9"');
  });

  it('writes the top-level version of a package.json, not a nested one listed first', () => {
    const file: VersionFile = {
      path: 'package.json',
      kind: 'package-json',
      text: '{\n  "engines": { "version": "x" },\n  "version": "0.1.0"\n}\n',
    };
    const written = writeVersion(file, '0.2.0', CRATE);
    expect(JSON.parse(written)).toEqual({ engines: { version: 'x' }, version: '0.2.0' });
  });

  it('refuses a version that is not semver', () => {
    expect(() => writeVersion(files('0.1.0')[0]!, '0.2', CRATE)).toThrow(InvalidVersionError);
  });
});

describe('files that disagree', () => {
  it('is none when every file has the expected version', () => {
    expect(disagreements(files('0.1.0'), '0.1.0', CRATE)).toEqual([]);
  });

  it('names each file that differs, and what it has', () => {
    const mixed = [...files('0.1.0').slice(0, 2), ...files('0.0.9').slice(2)];
    expect(disagreements(mixed, '0.1.0', CRATE)).toEqual([
      { path: 'apps/desktop/src-tauri/Cargo.toml', found: '0.0.9' },
      { path: 'apps/desktop/src-tauri/Cargo.lock', found: '0.0.9' },
    ]);
  });

  it('counts a file with no version as disagreeing, rather than failing the whole check', () => {
    const missing: VersionFile = {
      path: 'packages/ui/package.json',
      kind: 'package-json',
      text: '{}',
    };
    expect(disagreements([missing], '0.1.0', CRATE)).toEqual([
      { path: 'packages/ui/package.json', found: null },
    ]);
  });
});

describe('the crate name', () => {
  it('is the [package] name, not a dependency listed before it', () => {
    const file: VersionFile = {
      path: 'Cargo.toml',
      kind: 'cargo-toml',
      text: '[dependencies]\nname = "decoy"\n\n[package]\nname = "atlas"\nversion = "0.1.0"\n',
    };
    expect(cargoCrateName(file)).toBe('atlas');
  });

  it('says which Cargo.toml has none', () => {
    const file: VersionFile = { path: 'src-tauri/Cargo.toml', kind: 'cargo-toml', text: '[lib]\n' };
    expect(() => cargoCrateName(file)).toThrow(/src-tauri\/Cargo\.toml has no \[package\] name/);
  });
});

describe('a release tag', () => {
  it('matches when it is the version with a leading v', () => {
    expect(tagMismatch('v0.1.0', '0.1.0')).toBeNull();
    expect(tagMismatch('refs/tags/v1.0.0-rc.1', '1.0.0-rc.1')).toBeNull();
  });

  it.each([['0.1.0'], ['v0.1.1'], ['v0.1.0-rc.1'], ['release-0.1.0']])(
    'does not match when it is %s',
    (tag) => {
      expect(tagMismatch(tag, '0.1.0')).toMatch(/v0\.1\.0/);
    },
  );
});

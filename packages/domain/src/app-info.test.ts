import { describe, expect, it } from 'vitest';
import { createAppInfo, InvalidAppInfoError } from './app-info.ts';

describe('createAppInfo', () => {
  it('accepts a name and a semver version', () => {
    expect(createAppInfo({ name: 'Atlas', version: '0.1.0' })).toEqual({
      name: 'Atlas',
      version: '0.1.0',
      build: null,
    });
  });

  it('accepts a pre-release version', () => {
    expect(createAppInfo({ name: 'Atlas', version: '1.0.0-beta.2' }).version).toBe('1.0.0-beta.2');
  });

  it('trims surrounding whitespace from the name', () => {
    expect(createAppInfo({ name: '  Atlas  ', version: '0.1.0' }).name).toBe('Atlas');
  });

  it.each(['', '   '])('rejects a blank name (%j)', (name) => {
    expect(() => createAppInfo({ name, version: '0.1.0' })).toThrow(InvalidAppInfoError);
  });

  it.each(['1.0', 'v1.0.0', '1.0.0.0', '01.0.0', '1.0.0-', 'nightly', ''])(
    'rejects non-semver version %j',
    (version) => {
      expect(() => createAppInfo({ name: 'Atlas', version })).toThrow(InvalidAppInfoError);
    },
  );

  it('names the offending version in the error message', () => {
    expect(() => createAppInfo({ name: 'Atlas', version: 'nightly' })).toThrow(/"nightly"/);
  });

  it('keeps the commit a build was made from, as a short SHA', () => {
    expect(createAppInfo({ name: 'Atlas', version: '0.1.0', build: '61e907b' }).build).toBe(
      '61e907b',
    );
  });

  it.each([[null], [''], ['  ']])('has no build when none is known (%j)', (build) => {
    expect(createAppInfo({ name: 'Atlas', version: '0.1.0', build }).build).toBeNull();
  });

  it.each(['main', '61e9', 'g61e907b', '61E907B', '61e907b-dirty'])(
    'rejects a build that is not a commit SHA: %j',
    (build) => {
      expect(() => createAppInfo({ name: 'Atlas', version: '0.1.0', build })).toThrow(
        InvalidAppInfoError,
      );
    },
  );
});

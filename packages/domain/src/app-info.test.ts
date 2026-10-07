import { describe, expect, it } from 'vitest';
import { createAppInfo, InvalidAppInfoError } from './app-info.ts';

describe('createAppInfo', () => {
  it('accepts a name and a semver version', () => {
    expect(createAppInfo({ name: 'Atlas', version: '0.1.0' })).toEqual({
      name: 'Atlas',
      version: '0.1.0',
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
});

import { describe, expect, it } from 'vitest';
import { dataUrl, decodeBase64, encodeBase64 } from './base64.ts';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('base64', () => {
  it.each([
    [[], ''],
    [[77], 'TQ=='],
    [[77, 97], 'TWE='],
    [[77, 97, 110], 'TWFu'],
    [[0, 255, 128, 64], 'AP+AQA=='],
  ])('encodes %j as %s and back', (values, text) => {
    expect(encodeBase64(bytes(...values))).toBe(text);
    expect([...(decodeBase64(text) ?? [])]).toEqual(values);
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256).map((_, at) => at);
    expect(decodeBase64(encodeBase64(all))).toEqual(all);
  });

  it.each([
    ['a length that is not a multiple of four', 'TWF'],
    ['a character outside the alphabet', 'TW-u'],
    ['padding in the middle', 'TQ==TWFu'],
    ['whitespace', 'TWFu\n'],
  ])('refuses %s', (_why, text) => {
    expect(decodeBase64(text)).toBeNull();
  });

  it('makes a data URL', () => {
    expect(dataUrl('image/png', bytes(77))).toBe('data:image/png;base64,TQ==');
  });
});

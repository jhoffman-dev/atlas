import { describe, expect, it } from 'vitest';
import { isTombstoneBlock } from './index.ts';

const TOMBSTONE =
  '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","location":9,"annotationId":"A9","words":"3f2a"} -->';

describe('a block that is only tombstones', () => {
  it('is one tombstone', () => {
    expect(isTombstoneBlock(TOMBSTONE)).toBe(true);
  });

  it('is several, with blank lines and CRLF endings between them', () => {
    expect(isTombstoneBlock(`${TOMBSTONE}\r\n\r\n${TOMBSTONE}`)).toBe(true);
  });

  it('counts a tombstone of another version, still a hidden comment', () => {
    expect(isTombstoneBlock('<!-- atlas:highlight-removed {"v":9} -->')).toBe(true);
  });

  it('is not a block with any other line', () => {
    expect(isTombstoneBlock(`${TOMBSTONE}\nThe person's words.`)).toBe(false);
  });

  it('is not another comment, nor an empty block', () => {
    expect(isTombstoneBlock('<!-- a note to self -->')).toBe(false);
    expect(isTombstoneBlock('')).toBe(false);
  });

  it('is not a quoted tombstone, which is the person\'s words', () => {
    expect(isTombstoneBlock(`> ${TOMBSTONE}`)).toBe(false);
  });
});

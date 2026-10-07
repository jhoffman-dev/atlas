import { describe, expect, it } from 'vitest';
import { vaultPathName } from '../vault/vault-path.ts';
import { artifactPlacement } from './artifact.ts';

/** APFS, ext4 and NTFS all refuse a single name longer than 255 bytes (NTFS: UTF-16 units). */
const MAX_NAME_BYTES = 255;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

describe('artifactPlacement — adversarial titles', () => {
  // Titles arrive from a Claude session over the local API, unbounded.
  it.each([
    ['a 300-character title', 'x'.repeat(300)],
    ['a title of 70 emoji (4 bytes each)', '🎉'.repeat(70)],
  ])('names a note the disk can hold, for %s', (_why, title) => {
    const { notePath } = artifactPlacement({ title, taken: new Set() });
    expect(bytes(vaultPathName(notePath))).toBeLessThanOrEqual(MAX_NAME_BYTES);
  });

  it('keeps a numbered name within the limit when the title alone just fits', () => {
    const title = 'y'.repeat(252); // `${title}.md` is exactly 255 bytes
    const first = artifactPlacement({ title, taken: new Set() });
    expect(bytes(vaultPathName(first.notePath))).toBe(MAX_NAME_BYTES);

    const second = artifactPlacement({ title, taken: new Set([first.notePath]) });
    expect(bytes(vaultPathName(second.notePath))).toBeLessThanOrEqual(MAX_NAME_BYTES);
  });
});

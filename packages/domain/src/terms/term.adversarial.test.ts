import { describe, expect, it } from 'vitest';
import { newTermRefusal, variantsFromInput } from './term.ts';

/*
 * Adversarial (P28-05): zero-width characters, which text copied from a chat
 * or a web page often carries, are invisible in the Terms page's box but are
 * not whitespace to `\s` or `trim()`.
 */

const ZERO_WIDTH_SPACE = '\u200B';

describe('what was typed into a Terms page box, with zero-width characters in it', () => {
  it('drops a variant that is nothing but a zero-width space, as it drops a blank one', () => {
    expect(variantsFromInput(`lark spur, ${ZERO_WIDTH_SPACE}`)).toEqual(['lark spur']);
  });

  it('refuses a right spelling that is nothing but a zero-width space, as it refuses a blank one', () => {
    expect(newTermRefusal(ZERO_WIDTH_SPACE)).toBe('A term needs its right spelling.');
  });
});

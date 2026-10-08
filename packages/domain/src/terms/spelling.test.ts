import { describe, expect, it } from 'vitest';
import { tidySpelling, vocabularyKey } from './spelling.ts';
import { newTermRefusal } from './term.ts';
import { variantsFromInput } from './variants-input.ts';

/** 'نامه‌ها' (letters), written with the zero-width non-joiner that shapes it. */
const LETTERS = '\u0646\u0627\u0645\u0647\u200C\u0647\u0627';
/** A family emoji: three people joined by zero-width joiners into one. */
const FAMILY = '\u{1F469}\u200D\u{1F469}\u200D\u{1F467}';
const ZWNJ = '\u200C';
const ZWJ = '\u200D';

describe('the joiners in a spelling', () => {
  it('are kept where they shape a word or join an emoji', () => {
    expect(tidySpelling(LETTERS)).toBe(LETTERS);
    expect(tidySpelling(` ${FAMILY} `)).toBe(FAMILY);
    expect(vocabularyKey(LETTERS)).toBe(LETTERS);
    expect(variantsFromInput(`${LETTERS}, ${FAMILY}`)).toEqual([LETTERS, FAMILY]);
    expect(newTermRefusal(FAMILY)).toBeNull();
  });

  it('are nothing on their own, so a spelling of only joiners and spaces is blank', () => {
    expect(tidySpelling(`${ZWNJ} ${ZWJ}`)).toBe('');
    expect(variantsFromInput(`lark spur, ${ZWJ}, ${ZWNJ}\u200B`)).toEqual(['lark spur']);
    expect(newTermRefusal(ZWJ)).toBe('A term needs its right spelling.');
  });

  it('are not the zero-width space, word joiner or byte-order mark, which are dropped', () => {
    expect(tidySpelling('Lark\u200Bspur\u2060\uFEFF')).toBe('Larkspur');
  });
});

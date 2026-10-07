import { describe, expect, it } from 'vitest';
import { ownerSection } from '../chat/owner-section.ts';
import { cleanProfileName, PROFILE_NAME_LIMIT } from './profile.ts';

/* Adversarial pass on #10 / #1: names that look clean but are not. */

describe('cleanProfileName, against invisible and reordering characters', () => {
  it('drops bidi overrides and isolates, so a name reads as it is stored', () => {
    // U+202E makes everything after it display reversed, so a note shows a name it does not hold.
    for (const mark of ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩']) {
      expect(cleanProfileName(`Ada${mark} Lovelace`)).toBe('Ada Lovelace');
    }
  });

  it('drops zero-width spaces and the byte-order mark, which make two equal-looking names differ', () => {
    expect(cleanProfileName('Ada​ Lovelace')).toBe('Ada Lovelace');
    expect(cleanProfileName('﻿Ada Lovelace')).toBe('Ada Lovelace');
    expect(cleanProfileName('Ada⁠ Lovelace')).toBe('Ada Lovelace');
  });

  it('a name of nothing but invisible characters is no name', () => {
    expect(cleanProfileName('​​')).toBeNull();
    expect(cleanProfileName('﻿')).toBeNull();
    expect(cleanProfileName('‮')).toBeNull();
  });
});

describe('cleanProfileName, cutting at the limit', () => {
  it('never cuts a joined emoji in half', () => {
    // 98 letters, then a family emoji of five code points: the cut lands after its first ZWJ.
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const cut = cleanProfileName(`${'a'.repeat(PROFILE_NAME_LIMIT - 2)}${family}`) ?? '';
    expect(cut.endsWith('‍')).toBe(false);
    expect(cut === 'a'.repeat(PROFILE_NAME_LIMIT - 2) || cut.endsWith(family)).toBe(true);
  });

  it('never cuts a flag into a lone regional indicator', () => {
    const flag = '\u{1F1EF}\u{1F1F5}';
    const cut = cleanProfileName(`${'a'.repeat(PROFILE_NAME_LIMIT - 1)}${flag}`) ?? '';
    expect(cut.endsWith('\u{1F1EF}')).toBe(false);
  });
});

describe('ownerSection quotes the name exactly', () => {
  it('a nickname in double quotes reaches the model without backslashes it would copy', () => {
    // The prompt says "use exactly this name"; JSON escaping shows it as James \"Jim\" Hoffman.
    const section = ownerSection({ name: 'James "Jim" Hoffman', preferredName: null });
    expect(section).toContain('James "Jim" Hoffman');
    expect(section).not.toContain('\\"');
  });

  it('a backslash in a name is not doubled', () => {
    const section = ownerSection({ name: 'Ada\\Lovelace', preferredName: null });
    expect(section).not.toContain('Ada\\\\Lovelace');
  });
});

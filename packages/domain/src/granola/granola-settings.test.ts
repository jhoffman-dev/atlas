import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GRANOLA_TIME_ZONE,
  GRANOLA_GROUP_ADDRESSES_KEY,
  GRANOLA_PERIODIC_KEY,
  GRANOLA_TIME_ZONE_KEY,
  GRANOLA_WEBHOOK_KEY,
  parseGranolaSettings,
} from './granola-settings.ts';
import { GRANOLA_SELF_EMAILS_KEY, selfEmailsFromText } from '../profile/self-emails.ts';

describe('parseGranolaSettings', () => {
  it('reads every setting the vault gives', () => {
    expect(
      parseGranolaSettings({
        [GRANOLA_TIME_ZONE_KEY]: 'Europe/London',
        [GRANOLA_WEBHOOK_KEY]: true,
        [GRANOLA_PERIODIC_KEY]: false,
        [GRANOLA_GROUP_ADDRESSES_KEY]: ['eng@example.com', 'ops@example.com'],
        [GRANOLA_SELF_EMAILS_KEY]: ['mara.quill@example.com', 'mara@example.com'],
      }),
    ).toEqual({
      timeZone: 'Europe/London',
      webhook: true,
      periodic: false,
      groupAddresses: ['eng@example.com', 'ops@example.com'],
      selfEmails: ['mara.quill@example.com', 'mara@example.com'],
      groupAddressesProblem: null,
      selfEmailsProblem: null,
    });
  });

  it('is n8n’s zone, no webhook, the timer on and no addresses for a vault that says nothing', () => {
    expect(parseGranolaSettings({})).toEqual({
      timeZone: 'America/Los_Angeles',
      webhook: false,
      periodic: true,
      groupAddresses: [],
      selfEmails: [],
      groupAddressesProblem: null,
      selfEmailsProblem: null,
    });
    expect(DEFAULT_GRANOLA_TIME_ZONE).toBe('America/Los_Angeles');
  });

  it('reads the owner’s addresses from selfEmails, and granola_self_emails only while that is empty (#173)', () => {
    const alias = ['mara.quill@example.com'];
    expect(parseGranolaSettings({ [GRANOLA_SELF_EMAILS_KEY]: alias }).selfEmails).toEqual(alias);
    expect(
      parseGranolaSettings({ selfEmails: ['mq@example.org'], [GRANOLA_SELF_EMAILS_KEY]: alias }),
    ).toMatchObject({ selfEmails: ['mq@example.org'], selfEmailsProblem: null });
    expect(
      parseGranolaSettings({ selfEmails: [], [GRANOLA_SELF_EMAILS_KEY]: alias }).selfEmails,
    ).toEqual(alias);
    expect(parseGranolaSettings({ selfEmails: 'Mara' })).toMatchObject({
      selfEmails: [],
      selfEmailsProblem: 'Not an email address: “Mara”.',
    });
  });

  it('keys are the ones the vault’s settings note spells', () => {
    expect([
      GRANOLA_TIME_ZONE_KEY,
      GRANOLA_WEBHOOK_KEY,
      GRANOLA_PERIODIC_KEY,
      GRANOLA_GROUP_ADDRESSES_KEY,
      GRANOLA_SELF_EMAILS_KEY,
    ]).toEqual([
      'granola_time_zone',
      'granola_webhook',
      'granola_periodic',
      'granola_group_addresses',
      'granola_self_emails',
    ]);
  });

  it('trims the zone, and takes a blank or non-text one as unset', () => {
    expect(parseGranolaSettings({ [GRANOLA_TIME_ZONE_KEY]: '  Asia/Tokyo ' }).timeZone).toBe(
      'Asia/Tokyo',
    );
    for (const zone of ['', '   ', 7, null, ['Asia/Tokyo']]) {
      expect(parseGranolaSettings({ [GRANOLA_TIME_ZONE_KEY]: zone }).timeZone).toBe(
        DEFAULT_GRANOLA_TIME_ZONE,
      );
    }
  });

  it('turns the webhook on only for true itself, and the timer off only for false itself', () => {
    for (const value of ['true', 'yes', 1, null]) {
      expect(parseGranolaSettings({ [GRANOLA_WEBHOOK_KEY]: value }).webhook).toBe(false);
      expect(parseGranolaSettings({ [GRANOLA_PERIODIC_KEY]: value }).periodic).toBe(true);
    }
  });

  it('keeps the group addresses, trimmed and in lower case, and passes over empty items', () => {
    expect(
      parseGranolaSettings({
        [GRANOLA_GROUP_ADDRESSES_KEY]: [' Eng@example.com ', '', null, 'ops@example.com'],
      }),
    ).toMatchObject({
      groupAddresses: ['eng@example.com', 'ops@example.com'],
      groupAddressesProblem: null,
    });
  });

  it('reads a list with an item that is not one address as none, and names the item', () => {
    expect(
      parseGranolaSettings({
        [GRANOLA_GROUP_ADDRESSES_KEY]: ['eng@example.com', 4, 'ops@example.com, qa@example.com'],
      }),
    ).toMatchObject({
      groupAddresses: [],
      groupAddressesProblem: 'Not an email address: “4”, “ops@example.com, qa@example.com”.',
    });
    expect(
      parseGranolaSettings({ [GRANOLA_SELF_EMAILS_KEY]: [{ email: 'mara@example.com' }] }),
    ).toMatchObject({
      selfEmails: [],
      selfEmailsProblem: 'Not an email address: “a nested value”.',
    });
  });

  it('reads a setting that is neither text nor a list as none, and says so', () => {
    expect(parseGranolaSettings({ [GRANOLA_SELF_EMAILS_KEY]: 7 })).toMatchObject({
      selfEmails: [],
      selfEmailsProblem: 'It is not a list of email addresses.',
    });
  });

  it('reads one address written as text, not a list, as a list of that one', () => {
    expect(
      parseGranolaSettings({ [GRANOLA_GROUP_ADDRESSES_KEY]: ' eng@example.com ' }).groupAddresses,
    ).toEqual(['eng@example.com']);
    expect(
      parseGranolaSettings({ [GRANOLA_SELF_EMAILS_KEY]: 'mara@example.com' }).selfEmails,
    ).toEqual(['mara@example.com']);
    expect(parseGranolaSettings({ [GRANOLA_SELF_EMAILS_KEY]: '  ' }).selfEmails).toEqual([]);
  });

  it('reads addresses written by hand as text as the field reads them', () => {
    expect(
      parseGranolaSettings({
        [GRANOLA_SELF_EMAILS_KEY]: 'Mara.Quill@example.com; Mara Quill <mq@example.com>',
      }),
    ).toMatchObject({
      selfEmails: ['mara.quill@example.com', 'mq@example.com'],
      selfEmailsProblem: null,
    });
  });

  it('reads text that is not all addresses as none, and names what is not', () => {
    expect(
      parseGranolaSettings({ [GRANOLA_SELF_EMAILS_KEY]: 'mara@example.com and Mara' }),
    ).toMatchObject({
      selfEmails: [],
      selfEmailsProblem: 'Not an email address: “and”, “Mara”.',
    });
    expect(
      parseGranolaSettings({ [GRANOLA_GROUP_ADDRESSES_KEY]: 'eng@exa\u200Bmple.com' }),
    ).toMatchObject({
      groupAddresses: [],
      groupAddressesProblem: 'Not an email address: “eng@exa\\u200Bmple.com”.',
    });
  });

  it('keeps the person’s own list items as addresses only when each is one', () => {
    expect(
      parseGranolaSettings({
        [GRANOLA_SELF_EMAILS_KEY]: [
          ' mara@example.com ',
          '',
          null,
          'MQ@example.com',
          'mq@example.com',
        ],
      }),
    ).toMatchObject({
      selfEmails: ['mara@example.com', 'mq@example.com'],
      selfEmailsProblem: null,
    });
    expect(
      parseGranolaSettings({
        [GRANOLA_SELF_EMAILS_KEY]: ['mara@example.com', 'mara@.example.com'],
      }),
    ).toMatchObject({
      selfEmails: [],
      selfEmailsProblem: 'Not an email address: “mara@.example.com”.',
    });
  });

  it('reads no other setting as the person’s own addresses', () => {
    expect(
      parseGranolaSettings({
        meeting_group_addresses: ['eng@example.com'],
        email: 'mara@example.com',
        profileName: 'Mara Quill',
      }),
    ).toMatchObject({ groupAddresses: [], selfEmails: [] });
  });
});

/**
 * Characters the reader hands to the regex engine and cuts out of the text:
 * a count of its work that, unlike a clock, is the same on every machine.
 * A regex execution counts what it scanned, from where it started to the end
 * of its match, so a global replace is counted once over the text.
 */
function workOf(read: () => unknown): number {
  const { exec } = RegExp.prototype;
  const { slice, split } = String.prototype;
  let work = 0;
  const spies = [
    vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, input: string) {
      const from = this.global || this.sticky ? this.lastIndex : 0;
      const found = exec.call(this, input);
      work += (found === null ? input.length : found.index + found[0].length) - from;
      return found;
    }),
    vi.spyOn(String.prototype, 'slice').mockImplementation(function (
      this: string,
      ...range: [number?, number?]
    ) {
      const part = slice.apply(this, range);
      work += part.length;
      return part;
    }),
    vi.spyOn(String.prototype, 'split').mockImplementation(function (
      this: string,
      ...how: Parameters<string['split']>
    ) {
      work += this.length;
      return split.apply(this, how);
    }),
  ];
  try {
    read();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return work;
}

/** The regex literals `source` keeps as module constants, as their pattern text. */
function regexConstantsOf(source: string): string[] {
  return [...source.matchAll(/^const [A-Z_]+ = \/(.+)\/[a-z]*;$/gm)].map(([, pattern]) => {
    expect(() => new RegExp(pattern ?? '', 'u')).not.toThrow();
    return pattern ?? '';
  });
}

/** Whether `at` starts a quantifier that repeats without bound: `*`, `+` or `{n,`. */
function repeatsAt(pattern: string, at: number): boolean {
  const next = pattern[at];
  return next === '*' || next === '+' || (next === '{' && /^\{\d+,/.test(pattern.slice(at)));
}

/**
 * Whether a group that repeats without bound holds a quantifier or an
 * alternation, as `(a+)+` and `(a|a)*` do: the shape that makes a backtracking
 * engine try exponentially many ways to fail. Escapes and classes hold none.
 */
function hasNestedQuantifier(pattern: string): boolean {
  const groups: boolean[] = [];
  const holdsChoice = () => {
    if (groups.length > 0) groups[groups.length - 1] = true;
  };
  let inClass = false;
  for (let at = 0; at < pattern.length; at += 1) {
    const character = pattern[at];
    if (character === '\\') {
      // `\p{…}` and `\u{…}` are one escape, braces and all.
      const braced = 'pPu'.includes(pattern[at + 1] ?? '') && pattern[at + 2] === '{';
      at = braced ? Math.max(pattern.indexOf('}', at), at + 1) : at + 1;
    } else if (inClass) inClass = character !== ']';
    else if (character === '[') inClass = true;
    else if (character === '(') groups.push(false);
    else if (character === '|') holdsChoice();
    else if (character === ')') {
      const holds = groups.pop() ?? false;
      if (holds && repeatsAt(pattern, at + 1)) return true;
      if (holds) holdsChoice();
    } else if (repeatsAt(pattern, at) || (character === '?' && pattern[at - 1] !== '(')) {
      holdsChoice();
    }
  }
  return false;
}

describe('selfEmailsFromText', () => {
  it('reads addresses however they were separated, each once and in lower case, in order', () => {
    expect(
      selfEmailsFromText(
        ' mara.quill@example.com, MQ@example.com;\nmara.quill@EXAMPLE.com  mq@example.com ',
      ),
    ).toEqual({ ok: true, emails: ['mara.quill@example.com', 'mq@example.com'] });
  });

  it('reads nothing typed as no addresses', () => {
    expect(selfEmailsFromText('  ,; \n')).toEqual({ ok: true, emails: [] });
  });

  it('keeps the address of each "Name <address>", the name quoted or not', () => {
    expect(
      selfEmailsFromText(
        'Mara Quill <Mara.Quill@example.com>, "Quill, Mara" <mq@example.com>; <mara@example.org>',
      ),
    ).toEqual({
      ok: true,
      emails: ['mara.quill@example.com', 'mq@example.com', 'mara@example.org'],
    });
  });

  it('keeps an address typed bare beside a "Name <address>" with only a space between', () => {
    expect(selfEmailsFromText('mq@example.com Mara Quill <mara.quill@example.com>')).toEqual({
      ok: true,
      emails: ['mq@example.com', 'mara.quill@example.com'],
    });
  });

  it('names each entry that is not an address, and keeps none of them', () => {
    expect(selfEmailsFromText('mara.quill@example.com and also mq')).toEqual({
      ok: false,
      problem: 'Not an email address: “and”, “also”, “mq”. Nothing was saved.',
    });
  });

  it.each([
    ['no @', 'mara.example.com'],
    ['no dot in the domain', 'mara@example'],
    ['a domain ending in a dot', 'mara@example.'],
    ['nothing before the @', '@example.com'],
    ['two @', 'mara@quill@example.com'],
    ['angle brackets with no address', 'Mara Quill <someone>'],
    ['an unclosed bracket', 'Mara <mara@example.com'],
    ['a stray quote', '"mara@example.com'],
  ])('refuses %s', (_, typed) => {
    const read = selfEmailsFromText(typed);
    expect(read.ok).toBe(false);
  });

  it('names the whole "Name <not an address>" it refuses', () => {
    expect(selfEmailsFromText('Mara Quill <someone>')).toEqual({
      ok: false,
      problem: 'Not an email address: “Mara Quill <someone>”. Nothing was saved.',
    });
  });
  it.each([
    ['a leading dot in the local part', '.mara@example.com'],
    ['a trailing dot in the local part', 'mara.@example.com'],
    ['two dots in the local part', 'mara..quill@example.com'],
    ['an empty domain label', 'mara@example..com'],
    ['a domain starting with a dot', 'mara@.example.com'],
    ['a label starting with a hyphen', 'mara@-example.com'],
    ['a label ending with a hyphen', 'mara@example-.com'],
    ['a character atext does not allow', 'ma(ra@example.com'],
    ['an underscore in the domain', 'mara@exa_mple.com'],
    ['a zero-width space', 'mara@exa\u200Bmple.com'],
    ['a byte-order mark inside the brackets', 'Mara <\uFEFFmara@example.com>'],
    ['a NUL', 'mara@example.com\u0000'],
    ['an em space', 'mara\u2003quill@example.com'],
    ['a line separator', 'mara@example.com\u2028'],
    ['a Hangul filler, a letter that shows nothing', 'mara\u3164@example.com'],
  ])('refuses an address with %s', (_, typed) => {
    expect(selfEmailsFromText(typed).ok).toBe(false);
  });

  it.each([
    ['plus addressing', 'mara+granola@example.com'],
    ['atext symbols', "o'neil!#$%&*/=?^_`{|}~-@example.com"],
    ['a hyphen inside a label', 'mara@mail-host.example.com'],
    ['letters of another script', 'mara@exämple.com'],
  ])('keeps an address with %s', (_, typed) => {
    expect(selfEmailsFromText(typed)).toEqual({ ok: true, emails: [typed.toLowerCase()] });
  });

  it('reads no-break spaces as spaces, between a name and its address and between addresses', () => {
    expect(
      selfEmailsFromText('Mara\u202FQuill\u00A0<mara@example.com>\u2007mq@example.com'),
    ).toEqual({ ok: true, emails: ['mara@example.com', 'mq@example.com'] });
  });

  it('keeps a quoted name with escaped quotes in it, and a name on the line before its address', () => {
    expect(
      selfEmailsFromText(
        '"Quill \\"MQ, Mara\\"" <mq@example.com>\n"Quill, Mara"\r\n  <mara@example.com>',
      ),
    ).toEqual({ ok: true, emails: ['mq@example.com', 'mara@example.com'] });
  });

  it('reads a word on its own line as an entry of its own, not as the name of the next address', () => {
    expect(selfEmailsFromText('mara@example.com\nnotes\nMara <mq@example.com>')).toEqual({
      ok: false,
      problem: 'Not an email address: “notes”. Nothing was saved.',
    });
  });

  it('refuses an address in angle brackets that never close, before the next line', () => {
    expect(selfEmailsFromText('Mara <mara@example.com\nmq@example.com')).toEqual({
      ok: false,
      problem: 'Not an email address: “Mara <mara@example.com”. Nothing was saved.',
    });
  });

  it('refuses a quoted name with no address after it', () => {
    expect(selfEmailsFromText('"Mara Quill", mara@example.com').ok).toBe(false);
  });

  it('names a refused entry with what does not show escaped, cut short', () => {
    const long = `${'m'.repeat(80)}\u200B`;
    const read = selfEmailsFromText(`mara@exa\u200Bmple.com ${long}`);
    expect(read).toEqual({
      ok: false,
      problem: `Not an email address: “mara@exa\\u200Bmple.com”, “${'m'.repeat(60)}…”. Nothing was saved.`,
    });
  });

  it('names the first five entries it refuses, and counts the rest', () => {
    expect(selfEmailsFromText('a b c d e f g')).toEqual({
      ok: false,
      problem: 'Not an email address: “a”, “b”, “c”, “d”, “e” and 2 more. Nothing was saved.',
    });
  });

  it('reads up to 10 KB, and refuses more without reading it', () => {
    const tooMuch =
      'That is more than 10 KB of text, too much to be email addresses. Nothing was saved.';
    const atLimit = `${'m@example.com,'.repeat(730)}${' '.repeat(10 * 1024 - 14 * 730)}`;
    expect(selfEmailsFromText(atLimit)).toEqual({ ok: true, emails: ['m@example.com'] });
    expect(selfEmailsFromText(`${atLimit} `)).toEqual({ ok: false, problem: tooMuch });
    // Measured in bytes: 5,200 × "é" is 5,200 characters but 10,400 bytes.
    expect(selfEmailsFromText(`m@ex${'é'.repeat(5_200)}.com`)).toEqual({
      ok: false,
      problem: tooMuch,
    });
  });

  it('reads 10 KB with work that grows with its length, whatever it holds', () => {
    // Pathological shapes, each built to a length: 10× the text may be 10× the work, not 100×.
    const shapes: readonly ((length: number) => string)[] = [
      (length) => 'word '.repeat(length / 5),
      (length) => '<'.repeat(length),
      (length) => '"'.repeat(length),
      (length) => `"${'\\'.repeat(length - 2)}`,
      (length) => 'a@'.repeat(length / 2),
      (length) => 'a.'.repeat(length / 2),
      (length) => `x <${' '.repeat(length - 10)}`,
    ];
    for (const shape of shapes) {
      const small = workOf(() => selfEmailsFromText(shape(1_024)));
      const large = workOf(() => selfEmailsFromText(shape(10_240)));
      expect(small, shape(16).slice(0, 8)).toBeGreaterThan(0);
      expect(large, shape(16).slice(0, 8)).toBeLessThanOrEqual(12 * small);
    }
  });

  it('matches with no pattern that can backtrack catastrophically', () => {
    const source = readFileSync(new URL('../profile/email-addresses.ts', import.meta.url), 'utf8');
    const patterns = regexConstantsOf(source);
    expect(patterns.length).toBeGreaterThan(0);
    expect(source).not.toContain('new RegExp');
    for (const pattern of patterns) expect(hasNestedQuantifier(pattern), pattern).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { correctTerms } from './correct-terms.ts';
import { vocabulary, type NamedEntity } from './vocabulary.ts';
import type { TermNote } from './term.ts';

const term = (canonical: string, variants: readonly string[]): TermNote => ({
  path: createVaultPath(`Terms/${canonical}.md`),
  canonical,
  variants,
  kind: null,
});

const person = (name: string, aliases: readonly string[]): NamedEntity => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  aliases,
});

/** Larkspur Pay is misheard two ways; Mara Quill once; Tobias Fenn has no aliases at all. */
const VOCABULARY = vocabulary({
  terms: [
    term('Larkspur Pay', ['Lark Spur Pay', 'Larks Burr']),
    term('Q3', ['queue three', 'kyu3']),
  ],
  people: [person('Mara Quill', ['Mara Quil']), person('Tobias Fenn', [])],
  companies: [],
});

const corrected = (text: string) => correctTerms(text, VOCABULARY).text;

describe('correctTerms', () => {
  it('puts a misheard product name right, and says what it changed and where', () => {
    const result = correctTerms('We moved Lark Spur Pay to the new cache.', VOCABULARY);

    expect(result.text).toBe('We moved Larkspur Pay to the new cache.');
    expect(result.changes).toEqual([
      { start: 9, end: 22, from: 'Lark Spur Pay', to: 'Larkspur Pay' },
    ]);
  });

  it('corrects a colleague only where the vocabulary names the mishearing', () => {
    expect(corrected('Mara Quil agreed; Mara Quill wrote it; Tobias Fen did not.')).toBe(
      'Mara Quill agreed; Mara Quill wrote it; Tobias Fen did not.',
    );
  });

  it('matches whole words only, never inside a longer word', () => {
    expect(corrected('Lark Spur Payroll and Larks Burrow and xLarks Burr')).toBe(
      'Lark Spur Payroll and Larks Burrow and xLarks Burr',
    );
  });

  it('keeps the punctuation and possessives around a spelling', () => {
    expect(
      corrected('Lark Spur Pay’s rollout, (Larks Burr). "Mara Quil\'s" note: Lark Spur Pay!'),
    ).toBe('Larkspur Pay’s rollout, (Larkspur Pay). "Mara Quill\'s" note: Larkspur Pay!');
  });

  it('matches however the text cases or spaces a spelling, but never across a line break', () => {
    expect(corrected('lark spur pay, LARKS  BURR, Lark\tSpur Pay, Lark\nSpur Pay')).toBe(
      'Larkspur Pay, LARKSPUR PAY, Larkspur Pay, Lark\nSpur Pay',
    );
  });

  it('keeps capitals the text shouted, but not a spelling the vocabulary writes in capitals', () => {
    const shouting = vocabulary({
      terms: [term('Larkspur Pay', ['LSP'])],
      people: [],
      companies: [],
    });
    expect(correctTerms('LSP and lsp and Lsp', shouting).text).toBe(
      'Larkspur Pay and Larkspur Pay and Larkspur Pay',
    );
    expect(corrected('QUEUE THREE')).toBe('Q3');
  });

  it('leaves a right spelling as written, however it is cased', () => {
    const result = correctTerms('larkspur pay and MARA QUILL', VOCABULARY);
    expect(result).toEqual({ text: 'larkspur pay and MARA QUILL', changes: [] });
  });

  it('resolves overlapping spellings the same way every time: first to start, then the longer', () => {
    const overlapping = vocabulary({
      terms: [
        term('Spur Line', ['spur pay']),
        term('Larkspur Pay', ['Lark Spur', 'Lark Spur Pay']),
      ],
      people: [],
      companies: [],
    });
    // `Lark Spur Pay` starts first and is the longer at its start, so `Spur Pay` inside it is not read.
    expect(correctTerms('Lark Spur Pay', overlapping).text).toBe('Larkspur Pay');
    expect(correctTerms('the spur pay team', overlapping).text).toBe('the Spur Line team');
    expect(correctTerms('Lark Spur', overlapping).text).toBe('Larkspur Pay');
  });

  it('never touches a variant inside a name already spelt right', () => {
    const inside = vocabulary({
      terms: [term('Larkspur Pay', ['Larkspur'])],
      people: [],
      companies: [],
    });
    expect(correctTerms('Larkspur Pay and Larkspur', inside).text).toBe(
      'Larkspur Pay and Larkspur Pay',
    );
  });

  it('never changes wiki links, markdown links, URLs, tags, code or block ids', () => {
    const text = [
      'See [[Lark Spur Pay]] and ![[Lark Spur Pay.png]] and [Lark Spur Pay](https://example.com/Lark%20Spur) and [Mara Quil](<People/Mara Quil.md>).',
      'Open <https://example.com/Lark_Spur_Pay> or https://example.com/Lark-Spur-Pay now.',
      'Tagged #Larks-Burr and `Lark Spur Pay` and ``Mara Quil``.',
      '```',
      'Lark Spur Pay',
      '```',
      'Spoken by Mara Quil about kyu3 ^kyu3',
      '<!-- Lark Spur Pay -->',
    ].join('\n');
    const result = correctTerms(text, VOCABULARY);
    expect(result.changes.map((change) => change.from)).toEqual(['Mara Quil', 'kyu3']);
    expect(result.text).toBe(text.replace('by Mara Quil about kyu3 ', 'by Mara Quill about Q3 '));
  });

  it('corrects the words around a link right up to it', () => {
    expect(corrected('Lark Spur Pay[[Larks Burr]]Mara Quil')).toBe(
      'Larkspur Pay[[Larks Burr]]Mara Quill',
    );
  });

  it('changes nothing when the vocabulary is empty', () => {
    const none = vocabulary({ terms: [], people: [], companies: [] });
    expect(correctTerms('Lark Spur Pay', none)).toEqual({ text: 'Lark Spur Pay', changes: [] });
  });

  it('reads a spelling with pattern characters in it as the characters', () => {
    const symbols = vocabulary({
      terms: [term('C++ Guild', ['c plus plus', 'C+ Guild']), term('S/4', ['s.4'])],
      people: [],
      companies: [],
    });
    expect(correctTerms('the C+ Guild met; s.4 not s,4 or sx4', symbols).text).toBe(
      'the C++ Guild met; S/4 not s,4 or sx4',
    );
  });
});

/**
 * Property: whatever text the corrections run over, the bytes of every wiki
 * link, code span, fenced block and block id come through unchanged — and
 * the rest reads the same apart from the changes listed.
 */
describe('correctTerms never touches what is not prose', () => {
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const random = seeded(20261011);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  const WORDS = [
    'Lark Spur Pay',
    'Larks Burr',
    'Mara Quil',
    'queue three',
    'LARK SPUR PAY',
    'kyu3',
    'the',
  ];
  const PROSE = [...WORDS, ' ', ' ', '. ', "'s", '\n', '\n\n', '(', ')', '-', '[', ']'];
  /** Each span that must come through byte for byte, standing on a line of its own where markdown needs it. */
  const LITERALS = [
    () => `[[${pick(WORDS)}]]`,
    () => `[[${pick(WORDS)}|${pick(WORDS)}]]`,
    () => `\`${pick(WORDS)} ${pick(WORDS)}\``,
    () => `\n\`\`\`\n${pick(WORDS)}\n${pick(WORDS)}\n\`\`\`\n`,
    () => ` ^${pick(['Lark-Spur-Pay', 'kyu3', 'Mara-Quil', 't0001'])}\n`,
  ];

  function sample(): { text: string; literals: string[] } {
    let text = '';
    const literals: string[] = [];
    const pieces = 4 + Math.floor(random() * 20);
    for (let index = 0; index < pieces; index += 1) {
      if (random() < 0.3) {
        // A space before it, so it never runs on from a backtick or bracket the prose left open.
        const literal = pick(LITERALS)();
        literals.push(literal.trim());
        text += ` ${literal} `;
      } else {
        text += pick(PROSE);
      }
    }
    return { text, literals };
  }

  it('keeps every literal span in 500 random texts byte for byte', () => {
    let changed = 0;
    for (let round = 0; round < 500; round += 1) {
      const { text, literals } = sample();
      const result = correctTerms(text, VOCABULARY);
      changed += result.changes.length;
      for (const literal of literals) {
        const before = text.split(literal).length;
        expect(
          result.text.split(literal).length,
          `${JSON.stringify(literal)} in ${JSON.stringify(text)}`,
        ).toBe(before);
      }
      for (const change of result.changes) {
        expect(text.slice(change.start, change.end)).toBe(change.from);
        for (const literal of literals) {
          expect(literal.includes(change.from) && rangeInside(text, literal, change)).toBe(false);
        }
      }
    }
    // The texts held prose to correct as well, so the property was tested against real changes.
    expect(changed).toBeGreaterThan(100);
  });
});

/** Whether the change lies inside one of the places the literal is written. */
function rangeInside(
  text: string,
  literal: string,
  change: { start: number; end: number },
): boolean {
  for (let at = text.indexOf(literal); at !== -1; at = text.indexOf(literal, at + 1)) {
    if (change.start >= at && change.end <= at + literal.length) return true;
  }
  return false;
}

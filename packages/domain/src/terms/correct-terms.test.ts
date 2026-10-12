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

/**
 * Larkspur Pay is misheard two ways; Mara Quill once, by a term; Tobias Fenn is
 * a person with a nickname that is only an alias, which is never corrected.
 */
const VOCABULARY = vocabulary({
  terms: [
    term('Larkspur Pay', ['Lark Spur Pay', 'Larks Burr']),
    term('Q3', ['queue three', 'kyu3']),
    term('Mara Quill', ['Mara Quil']),
  ],
  people: [person('Mara Quill', ['Mara Quil', 'Quill']), person('Tobias Fenn', ['Toby'])],
  companies: [],
});

const corrected = (text: string) => correctTerms(text, VOCABULARY).text;

describe('correctTerms, at scale', () => {
  it('reads a long text against thousands of spellings in time that does not grow with them', () => {
    const terms = Array.from({ length: 5000 }, (_, at) =>
      term(`Termo${at} Alpha`, [`Ter Mo${at}`]),
    );
    const large = vocabulary({ terms, people: [], companies: [] });
    const line = 'We went over Ter Mo41 and Ter Mo4999 and the rest of the plan for the quarter.\n';
    const text = line.repeat(4000);

    const started = performance.now();
    const result = correctTerms(text, large);
    const elapsed = performance.now() - started;

    expect(result.changes).toHaveLength(8000);
    // Measured at about 100 ms including the tables; a generous bound, since the
    // old per-spelling pattern needed tens of seconds and nothing here is timing-tight.
    expect(elapsed).toBeLessThan(3000);
  });
});

describe('correctTerms', () => {
  it('puts a misheard product name right, and says what it changed and where', () => {
    const result = correctTerms('We moved Lark Spur Pay to the new cache.', VOCABULARY);

    expect(result.text).toBe('We moved Larkspur Pay to the new cache.');
    expect(result.changes).toEqual([
      { start: 9, end: 22, from: 'Lark Spur Pay', to: 'Larkspur Pay' },
    ]);
  });

  it('corrects a colleague only where a term names the mishearing', () => {
    expect(corrected('Mara Quil agreed; Mara Quill wrote it; Tobias Fen did not.')).toBe(
      'Mara Quill agreed; Mara Quill wrote it; Tobias Fen did not.',
    );
  });

  it('never rewrites with a person’s or a company’s alias, only with a term’s variant', () => {
    const aliasesOnly = vocabulary({
      terms: [],
      people: [person('Tobias Fenn', ['Toby', 'Tobias Fen'])],
      companies: [person('Larkspur Payroll', ['LP'])],
    });
    const text = 'Toby and Tobias Fen met LP about Larkspur Payroll.';

    expect(correctTerms(text, aliasesOnly)).toEqual({ text, changes: [] });
  });

  it('matches whole words only, never inside a longer word', () => {
    expect(corrected('Lark Spur Payroll and Larks Burrow and xLarks Burr and Larks Burr2')).toBe(
      'Lark Spur Payroll and Larks Burrow and xLarks Burr and Larks Burr2',
    );
  });

  it('keeps the punctuation and possessives around a spelling', () => {
    expect(
      corrected('Lark Spur Pay’s rollout, (Larks Burr). "Mara Quil\'s" note: Lark Spur Pay!'),
    ).toBe('Larkspur Pay’s rollout, (Larkspur Pay). "Mara Quill\'s" note: Larkspur Pay!');
  });

  it('matches however the text spaces a spelling, but never across a line break', () => {
    expect(corrected('Lark  Spur Pay, Larks \t Burr, Lark\tSpur Pay, Lark\nSpur Pay')).toBe(
      'Larkspur Pay, Larkspur Pay, Larkspur Pay, Lark\nSpur Pay',
    );
  });

  it('matches a spelling as written, capitals included, so a word that differs in case is not touched', () => {
    expect(corrected('lark spur pay, LARKS BURR, queue THREE, Kyu3')).toBe(
      'lark spur pay, LARKS BURR, queue THREE, Kyu3',
    );
  });

  it('leaves a common word alone when only its case differs from a variant', () => {
    const common = vocabulary({
      terms: [term('Mark Ledger', ['Mark']), term('Larkspur Pay', ['Pay'])],
      people: [],
      companies: [],
    });
    const text = 'Please mark the pay run; mark it. Attend to Mark and Pay.';

    expect(correctTerms(text, common).text).toBe(
      'Please mark the pay run; mark it. Attend to Mark Ledger and Larkspur Pay.',
    );
  });

  it('lets a variant be written in two cases when the term lists both', () => {
    const both = vocabulary({
      terms: [term('Larkspur', ['lark spur', 'Lark Spur'])],
      people: [],
      companies: [],
    });
    expect(correctTerms('lark spur and Lark Spur and LARK SPUR', both).text).toBe(
      'Larkspur and Larkspur and LARK SPUR',
    );
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

  it('needs a non-word neighbour on both sides of a spelling that has a symbol at one end', () => {
    const sharp = vocabulary({
      terms: [term('C Sharp', ['C#']), term('Dot Net', ['.NET'])],
      people: [],
      companies: [],
    });
    expect(correctTerms('C# and (C#), C#sharp, xC#, a.NET, .NET, x.NET', sharp).text).toBe(
      'C Sharp and (C Sharp), C#sharp, xC#, a.NET, Dot Net, x.NET',
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

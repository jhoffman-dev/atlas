/**
 * Adversarial tests for correcting a meeting's words and undoing it (P28-06,
 * issue #12). Committed red where they find a bug. All names are made up.
 */
import { describe, expect, it } from 'vitest';
import { vocabulary } from '../terms/vocabulary.ts';
import { countedWork, patternsMadeIn } from '../testing/counted-work.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  correctionProperties,
  correctMeetingBody,
  CORRECTIONS_KEY,
  undoMeetingCorrections,
} from './meeting-corrections.ts';

const VOCABULARY = vocabulary({
  terms: [
    {
      path: createVaultPath('Terms/Larkspur Pay.md'),
      canonical: 'Larkspur Pay',
      variants: ['Lark Spur Pay', 'Larks Burr'],
      kind: 'product',
    },
    {
      path: createVaultPath('Terms/Mara Quill.md'),
      canonical: 'Mara Quill',
      variants: ['Mara Quil'],
      kind: 'person',
    },
  ],
  people: [
    {
      path: createVaultPath('People/Mara Quill.md'),
      name: 'Mara Quill',
      aliases: ['Mara Quil', 'Quill'],
    },
  ],
  companies: [],
});

const meeting = (summary: string, transcript: string) =>
  ['# Weekly', '', '## Summary', '', summary, '', '## Transcript', '', transcript, ''].join('\n');

/** Mulberry32: a seeded RNG, so every run draws the same texts. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  'Mara',
  'Quill',
  'Quil',
  'Lark',
  'Spur',
  'Pay',
  'Larks',
  'Burr',
  'MARA',
  'QUIL',
  ' ',
  ' ',
  ' ',
  '  ',
  '\t',
  '\n',
  '\r\n',
  '**',
  '*',
  '`',
  '[[',
  ']]',
  '|',
  '#',
  '^',
  "'s",
  '-',
  '.',
  'é',
  '́',
  '🙂',
  'x',
  'and',
  '(',
  ')',
  '<!--',
  '-->',
  '~~~',
];

function randomText(next: () => number): string {
  const length = 1 + Math.floor(next() * 30);
  return Array.from({ length }, () => TOKENS[Math.floor(next() * TOKENS.length)]).join('');
}

describe('correctMeetingBody, adversarially', () => {
  it('gives back every original byte on undo, for any text (seeded)', () => {
    const next = seeded(12);
    for (let round = 0; round < 2000; round += 1) {
      const body = meeting(randomText(next), randomText(next));
      const correction = correctMeetingBody(body, VOCABULARY);
      if (correction.count === 0) continue;
      const undone = undoMeetingCorrections({
        body: correction.body,
        properties: correctionProperties(correction),
      });
      expect(undone, JSON.stringify(body)).toEqual({ ok: true, body });
    }
  });

  it('corrects nothing more the second time, for any text (seeded)', () => {
    const next = seeded(28);
    for (let round = 0; round < 2000; round += 1) {
      const body = meeting(randomText(next), randomText(next));
      const once = correctMeetingBody(body, VOCABULARY).body;
      expect(correctMeetingBody(once, VOCABULARY).count, JSON.stringify(body)).toBe(0);
    }
  });
});

describe('undoMeetingCorrections, against a hand-edited change list', () => {
  const ORIGINAL = meeting('Mara Quil and Mara Quill agreed.', '**Tobias Fenn** Fine.');

  it('refuses rather than write words the meeting never had, when a `from` was edited by hand', () => {
    const correction = correctMeetingBody(ORIGINAL, VOCABULARY);
    const properties = correctionProperties(correction);
    const [record] = properties[CORRECTIONS_KEY] as Record<string, unknown>[];
    const edited = { ...properties, [CORRECTIONS_KEY]: [{ ...record, from: 'Wrong Name' }] };

    const undone = undoMeetingCorrections({ body: correction.body, properties: edited });

    // The digest only vouches for the corrected body; nothing vouches for the original.
    expect(undone.ok).toBe(false);
  });

  it('refuses rather than misspell a name that was right all along, when an `at` was added by hand', () => {
    const correction = correctMeetingBody(ORIGINAL, VOCABULARY);
    const properties = correctionProperties(correction);
    const [record] = properties[CORRECTIONS_KEY] as { at: number[] }[];
    const rightAllAlong = correction.body.lastIndexOf('Mara Quill');
    const at = [...(record?.at ?? []), rightAllAlong];
    const edited = { ...properties, [CORRECTIONS_KEY]: [{ ...record, at, count: at.length }] };

    const undone = undoMeetingCorrections({ body: correction.body, properties: edited });

    expect(undone.ok && undone.body !== ORIGINAL).toBe(false);
  });
});

describe('correctMeetingBody, speaker labels', () => {
  // Decision: a misheard speaker is the same mishearing as in the words, and the
  // label is what links the turn to a person, so it is corrected like the words.
  it('corrects a misheard speaker in its **label**, leaving the time and id as they were', () => {
    const body = meeting('x', '**Mara Quil** [~00:00:05] Morning. ^t0001');

    expect(correctMeetingBody(body, VOCABULARY).body).toBe(
      meeting('x', '**Mara Quill** [~00:00:05] Morning. ^t0001'),
    );
  });
});

describe('correctMeetingBody, at scale', () => {
  it('corrects a 400-turn transcript with work that does not grow with its vocabulary', () => {
    const spellings = (count: number) =>
      vocabulary({
        terms: Array.from({ length: count }, (_, at) => ({
          path: createVaultPath(`Terms/Termo${at}.md`),
          canonical: `Termo${at} Alpha`,
          variants: [`Termo ${at} Alfa`, `Ter Mo${at}`],
          kind: null,
        })),
        people: [],
        companies: [],
      });
    const turns = Array.from(
      { length: 400 },
      (_, at) =>
        `**Speaker ${at % 3}** We went over Ter Mo${at} and Termo ${at} Alfa, and the rest of ` +
        `the plan for the quarter, long enough to be a real turn. ^t${String(at).padStart(4, '0')}`,
    );
    const body = meeting('Summary.', turns.join('\n\n'));
    // A vocabulary's tables are built once and kept, so each is built before its
    // correction is counted: what is compared is the reading alone. The patterns
    // made, building and reading, are compared whole: one pattern of every spelling
    // would be one regex execution to count, however long it ran.
    const correcting = (large: ReturnType<typeof vocabulary>) => {
      let count = 0;
      let work = 0;
      const patterns = patternsMadeIn(() => {
        correctMeetingBody(body, large);
        work = countedWork(() => {
          count = correctMeetingBody(body, large).count;
        });
      });
      return { work, count, patterns };
    };

    const few = correcting(spellings(400));
    const many = correcting(spellings(4000));
    expect(few.count).toBe(800);
    expect(many.count).toBe(800);
    // Ten times the spellings. The first build was one case-insensitive pattern
    // of 3000 alternatives, each with lookarounds: 18-23 s, against 30-160 ms.
    expect(many.work).toBeLessThan(few.work * 1.5);
    expect(many.patterns).toEqual(few.patterns);
  });
});

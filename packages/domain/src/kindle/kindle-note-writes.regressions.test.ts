import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '../testing/line-note-blocks.ts';
import { withHighlightComment, withoutHighlight } from '../highlights/edit-highlights.ts';
import { readHighlights } from '../highlights/highlight-block.ts';
import { literatureNoteText } from '../highlights/literature-note.ts';
import { kindleHighlightKey, kindleNoteKey, newKindleHighlights } from './kindle-highlight-key.ts';
import { recordedKindleKeys, withKindleHighlights } from './kindle-note-writes.ts';
import type { KindleHighlight } from './kindle-types.ts';

/*
 * Regressions found reviewing PR #514 (#508): a Kindle sync run again over a note it wrote
 * must add nothing, and must never lose what the person wrote or removed.
 * Books and words are fictional or public domain; ids are made up.
 */

const ASIN = 'B0ATTACK14';
const EMPTY = literatureNoteText({
  kind: 'kindle',
  title: 'The Lantern Keeper',
  author: 'Mira Osei',
  asin: ASIN,
  file: null,
});

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function passage(id: string | null, quote: string, location: number | null = 100): KindleHighlight {
  return {
    key: kindleHighlightKey({ asin: ASIN, annotationId: id, location, words: quote }),
    asin: ASIN,
    annotationId: id,
    style: 'highlight',
    colour: 'yellow',
    quote,
    note: null,
    location,
    page: location === null ? '12' : null,
    commentOn: null,
  };
}

/** A note typed on `on`, as the parser gives it (`readRow`). */
function typedOn(on: KindleHighlight, note: string): KindleHighlight {
  return {
    ...on,
    key: kindleNoteKey(on.key, note),
    style: 'note',
    colour: null,
    quote: '',
    note,
    commentOn: on.key,
  };
}

/** A note at a place with no passage, keyed as `readRow` keys it. */
function noteOnly(id: string | null, note: string, location: number): KindleHighlight {
  const placed = kindleHighlightKey({ asin: ASIN, annotationId: id, location, words: note });
  return {
    key: id === null ? placed : kindleNoteKey(placed, note),
    asin: ASIN,
    annotationId: id,
    style: 'note',
    colour: null,
    quote: '',
    note,
    location,
    page: null,
    commentOn: null,
  };
}

/** One sync of `exported` into `text`, as `syncKindle` and the sink do it. */
function sync(text: string, exported: readonly KindleHighlight[], random = seeded(3)): string {
  const fresh = newKindleHighlights(exported, recordedKindleKeys(text, ASIN, noteBlocks));
  return withKindleHighlights({ text, asin: ASIN, highlights: fresh, random, noteBlocks }).text;
}

const count = (text: string, words: string) => text.split(words).length - 1;

describe('a Kindle sync run again adds nothing (regression)', () => {
  it('adds a typed note holding an unbalanced %% once, not again on every sync', () => {
    const quote = passage('A1', 'The lamp was lit at dusk.');
    const exported = [quote, typedOn(quote, 'Only 50%% of the lamps')];
    const once = sync(EMPTY, exported);
    const twice = sync(once, exported);
    expect(twice).toBe(once);
  });

  it('adds a typed note that arrives later and holds %% once, not again on every sync', () => {
    const quote = passage('A1', 'The lamp was lit at dusk.');
    const first = sync(EMPTY, [quote]);
    const exported = [quote, typedOn(quote, 'see note %%')];
    const once = sync(first, exported);
    expect(sync(once, exported)).toBe(once);
  });

  it('records a note typed later after a long comment of 64 paragraphs, adding it once', () => {
    const quote = passage('A1', 'The lamp was lit at dusk.');
    const long = Array.from({ length: 64 }, (_, at) => `Thought ${at + 1}.`).join('\n\n');
    const exported = [quote, typedOn(quote, long), typedOn(quote, 'A late note.')];
    const once = sync(EMPTY, exported);
    const twice = sync(once, exported);
    const thrice = sync(twice, exported);
    expect(count(thrice, 'A late note.')).toBe(1);
  });
});

describe('what the person removed stays removed (regression)', () => {
  it('does not bring back a Kindle highlight the person removed from the note', () => {
    const kept = passage('A1', 'The lamp was lit at dusk.', 100);
    const unwanted = passage('A2', 'A sentence the reader did not want.', 140);
    const synced = sync(EMPTY, [kept, unwanted]);
    const id = readHighlights(synced, noteBlocks).find(
      (block) => block.quote === unwanted.quote,
    )?.id;
    expect(id).toBeDefined();
    const removed = withoutHighlight({ text: synced, id: id ?? '', noteBlocks });
    expect(sync(removed, [kept, unwanted])).not.toContain(unwanted.quote);
  });
});

/*
 * Property: a book's export grows sync by sync (passages, then notes typed on
 * them later, notes at a place of their own, with and without Amazon ids),
 * and the person writes their own paragraph into some comments between syncs.
 * After every sync: running it again changes nothing, each passage's block is
 * there once, every note's words are there once, and every paragraph the
 * person wrote is still there.
 */
describe('growing exports synced again and again (regression, property)', () => {
  const WORDS = ['lamp', 'harbour', 'keeper', 'tide', 'stone', 'gull', 'rope', 'salt', 'ember'];

  function sentence(random: () => number, at: number): string {
    const words = Array.from({ length: 3 + Math.floor(random() * 5) }, () => {
      return WORDS[Math.floor(random() * WORDS.length)] ?? 'lamp';
    });
    return `${words.join(' ')} ${at}.`;
  }

  for (const seed of [11, 29, 47, 83, 101, 137, 211, 307]) {
    it(`keeps one of everything and every word of the person's (seed ${seed})`, () => {
      const random = seeded(seed);
      const exported: KindleHighlight[] = [];
      const passages: KindleHighlight[] = [];
      const notes: string[] = [];
      const own: string[] = [];
      let text = EMPTY;
      for (let round = 0; round < 6; round += 1) {
        for (let added = 0; added < 3; added += 1) {
          const at = exported.length + 1;
          const id = random() < 0.6 ? `A${seed}x${at}` : null;
          const roll = random();
          if (roll < 0.55 || passages.length === 0) {
            const quote = passage(id, `Passage ${sentence(random, at)}`, 100 + at * 7);
            passages.push(quote);
            exported.push(quote);
          } else if (roll < 0.85) {
            const on = passages[Math.floor(random() * passages.length)] as KindleHighlight;
            const words = `Typed ${sentence(random, at)}`;
            notes.push(words);
            exported.push(typedOn(on, words));
          } else {
            const words = `Margin ${sentence(random, at)}`;
            notes.push(words);
            exported.push(noteOnly(id, words, 5000 + at));
          }
        }
        text = sync(text, exported, seeded(seed + round));
        expect(sync(text, exported, seeded(seed + round + 99))).toBe(text);
        const blocks = readHighlights(text, noteBlocks);
        for (const quote of passages) {
          expect(blocks.filter((block) => block.quote === quote.quote)).toHaveLength(1);
        }
        // A note at a place of its own also has its words in the hidden marker: count comments.
        const comments = blocks.map((block) => block.comment).join('\n\n');
        for (const words of notes) expect(count(comments, words)).toBe(1);
        for (const words of own) expect(count(comments, words)).toBe(1);

        const target = blocks[Math.floor(random() * blocks.length)];
        if (target !== undefined && random() < 0.5) {
          const mine = `Mine ${round} for seed ${seed}.`;
          own.push(mine);
          const comment = target.comment.trim() === '' ? mine : `${target.comment}\n\n${mine}`;
          text = withHighlightComment({ text, id: target.id, comment, noteBlocks });
        }
      }
    });
  }
});

describe('a typed note added later leaves the comment before it as it was (regression)', () => {
  it('keeps the bytes of a comment written without the space after its quote mark', () => {
    const quote = passage('A1', 'The lamp was lit at dusk.');
    const synced = sync(EMPTY, [quote]);
    const own = synced.replace(/(atlas:highlight [^\n]*-->\n)/, '$1>first thought\n>  second\n');
    const after = sync(own, [quote, typedOn(quote, 'Typed on the Kindle.')]);
    expect(after).toContain('>first thought\n>  second\n');
    expect(readHighlights(after, noteBlocks)[0]?.comment).toBe(
      'first thought\n second\n\nTyped on the Kindle.',
    );
    expect(after.startsWith(own.slice(0, own.indexOf('>first thought\n>  second\n')))).toBe(true);
  });
});

describe('a highlight with no place is skipped, the rest written (regression)', () => {
  const roman = (): KindleHighlight => ({
    ...passage('A8', 'In the preface.', null),
    page: 'xiv',
  });

  it('writes the other highlights and names the one it could not place', () => {
    const quote = passage('A1', 'The lamp was lit at dusk.');
    const result = withKindleHighlights({
      text: EMPTY,
      asin: ASIN,
      highlights: [quote, roman()],
      random: seeded(3),
      noteBlocks,
    });
    expect(result.written).toBe(1);
    expect(result.unplaced).toEqual(['page xiv']);
    expect(readHighlights(result.text, noteBlocks).map((block) => block.quote)).toEqual([
      'The lamp was lit at dusk.',
    ]);
  });

  it('skips a note typed on a passage it could not place, rather than refusing the book', () => {
    const quote = passage('A1', 'The lamp was lit at dusk.');
    const lost = roman();
    const result = withKindleHighlights({
      text: EMPTY,
      asin: ASIN,
      highlights: [quote, lost, typedOn(lost, 'Typed in the preface.')],
      random: seeded(3),
      noteBlocks,
    });
    expect(result.written).toBe(1);
    expect(result.unplaced).toHaveLength(2);
  });

  it('changes nothing, and counts nothing written, when that is all there is', () => {
    const result = withKindleHighlights({
      text: EMPTY,
      asin: ASIN,
      highlights: [roman()],
      random: seeded(3),
      noteBlocks,
    });
    expect(result).toEqual({ text: EMPTY, written: 0, unplaced: ['page xiv'] });
  });
});

describe('a removed Kindle highlight leaves a hidden tombstone (regression)', () => {
  const kept = passage('A1', 'The lamp was lit at dusk.', 100);
  const unwanted = passage('A2', 'A sentence the reader did not want.', 140);

  function removedFrom(text: string, quote: string): string {
    const id = readHighlights(text, noteBlocks).find((block) => block.quote === quote)?.id;
    return withoutHighlight({ text, id: id ?? '', noteBlocks });
  }

  it('is a comment line Obsidian hides, not a highlight, and keeps the others', () => {
    const synced = sync(EMPTY, [kept, unwanted]);
    const removed = removedFrom(synced, unwanted.quote);
    expect(removed).toMatch(/^<!-- atlas:highlight-removed \{[^\n]*\} -->$/m);
    expect(removed).not.toContain(unwanted.quote);
    expect(readHighlights(removed, noteBlocks).map((block) => block.quote)).toEqual([kept.quote]);
  });

  it('keeps a note typed on the removed highlight from arriving, and the book from failing', () => {
    const typed = typedOn(unwanted, 'A thought on it.');
    const exported = [kept, unwanted, typed];
    const removed = removedFrom(sync(EMPTY, exported), unwanted.quote);
    expect(newKindleHighlights(exported, recordedKindleKeys(removed, ASIN, noteBlocks))).toEqual(
      [],
    );
    expect(sync(removed, exported)).toBe(removed);
  });

  it('survives the writes made after it: a comment, another removal, new highlights', () => {
    const removed = removedFrom(sync(EMPTY, [kept, unwanted]), unwanted.quote);
    const marker = /^<!-- atlas:highlight-removed .*-->$/m.exec(removed)?.[0] ?? '';
    expect(marker).not.toBe('');
    const another = passage('A3', 'Another passage entirely.', 180);
    const grown = sync(removed, [kept, unwanted, another]);
    expect(grown).toContain(marker);
    const id = readHighlights(grown, noteBlocks)[0]?.id ?? '';
    const edited = withHighlightComment({ text: grown, id, comment: 'Mine.', noteBlocks });
    expect(edited).toContain(marker);
    expect(sync(edited, [kept, unwanted, another])).toBe(edited);
  });

  it('is left only for a Kindle highlight: a PDF highlight removed leaves nothing behind', () => {
    const pdf =
      `${EMPTY}> A PDF quote.\n> <!-- atlas:highlight {"v":1,"mark":"highlight","color":"yellow",` +
      `"kind":"pdf","page":3,"exact":"A PDF quote.","rects":[]} -->\n\n^pdf001\n`;
    expect(withoutHighlight({ text: pdf, id: 'pdf001', noteBlocks })).toBe(EMPTY);
  });

  it('does not make the note unreadable to a later append', () => {
    const removed = removedFrom(sync(EMPTY, [kept, unwanted]), unwanted.quote);
    expect(() => sync(removed, [kept, passage('A9', 'Fresh words.', 300)])).not.toThrow();
  });
});

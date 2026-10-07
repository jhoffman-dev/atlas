import { describe, expect, it } from 'vitest';
import {
  anchorPlaces,
  anchorsIn,
  locateFragment,
  withAnchorAt,
  type EditorDocument,
} from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';
import { generatedDocument } from './writer-fuzz.test-support.ts';

/*
 * The promise of P26-01, over seeded notes: an id given to any block of a
 * note, in any place a block can take one, is the only change to the file —
 * every other byte stays where it was — and the note reads it back on that
 * block.
 */

const SEEDS = 400;

/** A seeded note as it would be on disk: written once, the way the app writes. */
function noteOnDisk(seed: number): string {
  const doc = generatedDocument(seed);
  return serializeMarkdownBody({ originalBody: '', parsed: parseMarkdownBody(''), doc });
}

/** Every place in the note that could take an id and has none, as paths from the document. */
function openPlaces(doc: EditorDocument): number[][] {
  return doc.content.flatMap((block, index) =>
    anchorPlaces(block)
      .map((path) => [index, ...path])
      .filter((at) => {
        const node = at
          .slice(1)
          .reduce((current, step) => current.content?.[step] ?? current, block);
        return typeof node.attrs?.['anchor'] !== 'string';
      }),
  );
}

/** The id's own writing, when `after` is `before` with only that put in; null otherwise. */
function insertion(before: string, after: string): string | null {
  const caret = after.indexOf('^zz9');
  for (const written of [' ^zz9', '\n\n^zz9', '\r\n\r\n^zz9']) {
    const start = caret - (written.length - '^zz9'.length);
    if (start < 0 || after.slice(start, caret + 4) !== written) continue;
    if (after.slice(0, start) + after.slice(caret + 4) === before) return written;
  }
  return null;
}

describe('giving any block an id changes nothing else in the file', () => {
  it(`holds for every open place in ${SEEDS} seeded notes`, () => {
    const failures: string[] = [];
    let places = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const body = noteOnDisk(seed);
      const parsed = parseMarkdownBody(body);
      for (const at of openPlaces(parsed.doc)) {
        places += 1;
        const doc = withAnchorAt(parsed.doc, at, 'zz9');
        const written = serializeMarkdownBody({ originalBody: body, parsed, doc });
        const added = insertion(body, written);
        const reread = parseMarkdownBody(written).doc;
        const found = locateFragment(reread, { kind: 'block', id: 'zz9' });
        const ok =
          added !== null &&
          /^(?: \^zz9|\r?\n\r?\n\^zz9)$/.test(added) &&
          JSON.stringify(found) === JSON.stringify(at) &&
          anchorsIn(reread).size === anchorsIn(parsed.doc).size + 1;
        if (!ok)
          failures.push(
            `seed ${seed} at ${JSON.stringify(at)} added=${JSON.stringify(added)} found=${JSON.stringify(found)} ids=${anchorsIn(reread).size}/${anchorsIn(parsed.doc).size}`,
          );
      }
    }
    expect(places, 'places tried').toBeGreaterThan(SEEDS);
    expect(failures.slice(0, 5), `${failures.length} of ${places} places`).toEqual([]);
  }, 120_000);
});

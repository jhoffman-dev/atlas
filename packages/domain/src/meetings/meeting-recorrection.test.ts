import { describe, expect, it } from 'vitest';
import { vocabulary } from '../terms/vocabulary.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  correctionProperties,
  correctMeetingBody,
  CORRECTIONS_DIGEST_KEY,
  CORRECTIONS_KEY,
  CORRECTIONS_ORIGINAL_DIGEST_KEY,
  NOTHING_CORRECTED_PROPERTIES,
  recordedCorrections,
  recorrectMeetingBody,
  UNDONE_CORRECTION_PROPERTIES,
  undoMeetingCorrections,
} from './meeting-corrections.ts';

const term = (canonical: string, variants: string[]) => ({
  path: createVaultPath(`Terms/${canonical}.md`),
  canonical,
  variants,
  kind: 'product' as const,
});

/** The terms the meeting arrived under, and the same with a spelling learned since. */
const THEN = vocabulary({ terms: [term('Larkspur Pay', ['Lark Spur Pay'])], people: [], companies: [] });
const NOW = vocabulary({
  terms: [term('Larkspur Pay', ['Lark Spur Pay', 'Larkspar Pay'])],
  people: [],
  companies: [],
});

const ORIGINAL = [
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Send me the Lark Spur Pay file. ^t0001',
  '',
  '**Ada Venn** [~00:00:09] Larkspar Pay needs its review booked. ^t0002',
  '',
].join('\n');

/** The meeting as the import left it: corrected by the terms of then, with the record of it. */
function arrived() {
  const correction = correctMeetingBody(ORIGINAL, THEN);
  return { body: correction.body, properties: correctionProperties(correction) };
}

describe('correcting a meeting again, for a term added since it arrived', () => {
  it('puts the new spelling right, and records every correction afresh', () => {
    const again = recorrectMeetingBody({ ...arrived(), vocabulary: NOW });

    expect(again?.body).toContain('Send me the Larkspur Pay file.');
    expect(again?.body).toContain('Larkspur Pay needs its review booked.');
    expect(again?.count).toBe(2);
    expect(recordedCorrections(again!.values)?.map(({ from, to }) => [from, to])).toEqual([
      ['Lark Spur Pay', 'Larkspur Pay'],
      ['Larkspar Pay', 'Larkspur Pay'],
    ]);
  });

  it('keeps one Undo that puts back every original word, the first correction’s too', () => {
    const again = recorrectMeetingBody({ ...arrived(), vocabulary: NOW })!;

    const undone = undoMeetingCorrections({ body: again.body, properties: again.values });

    expect(undone).toEqual({ ok: true, body: ORIGINAL });
  });

  it('is nothing to do when today’s terms leave the meeting as it reads', () => {
    expect(recorrectMeetingBody({ ...arrived(), vocabulary: THEN })).toBeNull();
    expect(
      recorrectMeetingBody({ body: ORIGINAL, properties: {}, vocabulary: { entries: [] } }),
    ).toBeNull();
  });

  it('puts a word back to what was said when its term no longer lists it', () => {
    const { body, properties } = arrived();
    const without = vocabulary({ terms: [term('Larkspur Pay', [])], people: [], companies: [] });

    const again = recorrectMeetingBody({ body, properties, vocabulary: without });

    expect(again?.body).toBe(ORIGINAL);
    expect(again?.count).toBe(0);
    expect(again?.values).toEqual({
      ...NOTHING_CORRECTED_PROPERTIES,
      [CORRECTIONS_DIGEST_KEY]: null,
      [CORRECTIONS_ORIGINAL_DIGEST_KEY]: null,
    });
  });

  it('corrects the words as they are now when they were edited since, and Undo goes back to those', () => {
    const { body, properties } = arrived();
    const edited = body.replace('its review booked', 'its review booked today');

    const again = recorrectMeetingBody({ body: edited, properties, vocabulary: NOW })!;

    expect(again.body).toContain('Larkspur Pay needs its review booked today.');
    // Only the new spelling is this correction's: the first was no longer its to take back.
    expect(again.count).toBe(1);
    expect(undoMeetingCorrections({ body: again.body, properties: again.values })).toEqual({
      ok: true,
      body: edited,
    });
  });

  it('corrects a meeting whose corrections were undone, when the person asks', () => {
    const again = recorrectMeetingBody({
      body: ORIGINAL,
      properties: UNDONE_CORRECTION_PROPERTIES,
      vocabulary: NOW,
    });

    expect(again?.count).toBe(2);
    expect(again?.values[CORRECTIONS_KEY]).not.toBe('undone');
  });

  it('corrects a meeting marked as read with nothing to correct, once a term lists what it holds', () => {
    const again = recorrectMeetingBody({
      body: ORIGINAL.replace('Lark Spur Pay', 'Larkspur Pay'),
      properties: NOTHING_CORRECTED_PROPERTIES,
      vocabulary: NOW,
    });

    expect(again?.count).toBe(1);
    expect(again?.body).not.toContain('Larkspar Pay');
  });
});

import { describe, expect, it } from 'vitest';
import { TRANSCRIPT_LIMIT } from '@atlas/domain';
import { fakeGranola, granolaNote, granolaTurn } from '../testing/fake-granola.ts';
import { listGranolaNotes, readGranolaNote } from './granola-reading.ts';
import type { GranolaPort } from './ports.ts';

const VAULT = '/Users/mara/Vault';
const send = <T>(request: () => Promise<T>) => request();
const readerOf = (granola: GranolaPort) => ({ granola, vault: VAULT, send });

const notes = Array.from({ length: 5 }, (_, at) =>
  granolaNote(`not_bbbbbbbbbbbbb${at}`, { updatedAt: `2026-10-0${at + 1}T12:00:00Z` }),
);

describe('listGranolaNotes', () => {
  it('reads every page, from the watermark given', async () => {
    const granola = fakeGranola({ notes, pageSize: 2 });

    const listed = await listGranolaNotes(readerOf(granola.port), '2026-10-01T12:00:00Z');

    expect(listed.notes.map((note) => note.id)).toEqual(notes.slice(1).map((note) => note.id));
    expect(listed.unreadable).toEqual([]);
    expect(granola.calls).toEqual([
      { call: 'list', updatedAfter: '2026-10-01T12:00:00Z', cursor: null },
      { call: 'list', updatedAfter: '2026-10-01T12:00:00Z', cursor: '2' },
    ]);
  });

  it('lists a note that comes on two pages once, as its later listing says', async () => {
    const granola = fakeGranola();
    const [first, second] = notes;
    let page = 0;
    granola.port.listNotes = async () => {
      page += 1;
      return page === 1
        ? { notes: [first!, second!], unreadable: [], cursor: 'next' }
        : {
            notes: [{ ...first!, updated_at: '2026-10-09T00:00:00Z' }],
            unreadable: [],
            cursor: null,
          };
    };

    const listed = await listGranolaNotes(readerOf(granola.port), null);

    expect(listed.notes.map((note) => [note.id, note.updated_at])).toEqual([
      [first!.id, '2026-10-09T00:00:00Z'],
      [second!.id, second!.updated_at],
    ]);
  });

  it('keeps every page’s unreadable notes beside the readable ones', async () => {
    const granola = fakeGranola();
    const [first, second] = notes;
    const odd = (id: string | null) => ({ id, reason: 'its updated_at is not text' });
    let page = 0;
    granola.port.listNotes = async () => {
      page += 1;
      return page === 1
        ? { notes: [first!], unreadable: [odd('not_odd1')], cursor: 'next' }
        : { notes: [second!], unreadable: [odd(null)], cursor: null };
    };

    const listed = await listGranolaNotes(readerOf(granola.port), null);

    expect(listed.notes.map((note) => note.id)).toEqual([first!.id, second!.id]);
    expect(listed.unreadable).toEqual([odd('not_odd1'), odd(null)]);
  });

  it('calls a list that hands back the same page again malformed', async () => {
    const granola = fakeGranola();
    granola.port.listNotes = async () => ({ notes: [], unreadable: [], cursor: 'again' });
    await expect(listGranolaNotes(readerOf(granola.port), null)).rejects.toMatchObject({
      failure: { kind: 'malformed', message: 'Granola sent the same page of notes again' },
    });
  });

  it('stops a list that never ends', async () => {
    const granola = fakeGranola();
    let page = 0;
    granola.port.listNotes = async () => ({
      notes: [],
      unreadable: [],
      cursor: String((page += 1)),
    });
    await expect(listGranolaNotes(readerOf(granola.port), null)).rejects.toMatchObject({
      failure: { kind: 'malformed', message: 'the list of notes ran past 200 pages' },
    });
    expect(page).toBe(200);
  });
});

describe('readGranolaNote', () => {
  const [note] = notes;
  const id = note!.id;

  it('reads a note with its transcript inline in one call', async () => {
    const granola = fakeGranola({ notes });
    await expect(readGranolaNote(readerOf(granola.port), id)).resolves.toEqual({
      tooLong: false,
      note,
    });
    expect(granola.calls).toEqual([{ call: 'note', id, transcript: true }]);
  });

  it('holds a transcript sent inline to the limit too, keeping the note to name it', async () => {
    const long = granolaTurn('x'.repeat(TRANSCRIPT_LIMIT.characters + 1), '2026-10-06T17:00:00Z');
    const giant = { ...note!, transcript: [long] };
    const granola = fakeGranola({ notes: [giant] });

    await expect(readGranolaNote(readerOf(granola.port), id)).resolves.toEqual({
      tooLong: true,
      note: { ...giant, transcript: null },
    });
    expect(granola.calls).toEqual([{ call: 'note', id, transcript: true }]);
  });

  it('takes an inline transcript right at the limit', async () => {
    const atLimit = granolaTurn('x'.repeat(TRANSCRIPT_LIMIT.characters), '2026-10-06T17:00:00Z');
    const granola = fakeGranola({ notes: [{ ...note!, transcript: [atLimit] }] });
    const read = await readGranolaNote(readerOf(granola.port), id);
    expect(read.tooLong).toBe(false);
    expect(read.note.transcript).toEqual([atLimit]);
  });

  it('reads a transcript too large to send inline from its pages, in order', async () => {
    const granola = fakeGranola({ notes });
    const turns = [
      granolaTurn('One.', '2026-10-06T17:00:00Z'),
      granolaTurn('Two.', '2026-10-06T17:00:01Z'),
      granolaTurn('Three.', '2026-10-06T17:00:02Z'),
    ];
    granola.pageTranscript(id, [[turns[0]], [turns[1]], [turns[2]]]);

    const read = await readGranolaNote(readerOf(granola.port), id);

    expect(read).toEqual({ tooLong: false, note: { ...note, transcript: turns } });
    expect(granola.calls).toEqual([
      { call: 'note', id, transcript: true },
      { call: 'note', id, transcript: false },
      { call: 'transcript', id, cursor: null },
      { call: 'transcript', id, cursor: '1' },
      { call: 'transcript', id, cursor: '2' },
    ]);
  });

  /** The note too long to take, as read without its transcript: there to name and link to. */
  const tooLong = { tooLong: true, note: { ...note, transcript: null } };

  it('is too long for a transcript past the limit in text, and reads no further', async () => {
    const granola = fakeGranola({ notes });
    const long = granolaTurn('x'.repeat(TRANSCRIPT_LIMIT.characters + 1), '2026-10-06T17:00:00Z');
    granola.pageTranscript(id, [[long], [granolaTurn('More.', '2026-10-06T17:00:01Z')]]);

    await expect(readGranolaNote(readerOf(granola.port), id)).resolves.toEqual(tooLong);
    expect(granola.count('transcript')).toBe(1);
  });

  it('is too long for a transcript whose last page takes it past the limit', async () => {
    const granola = fakeGranola({ notes });
    const long = granolaTurn('x'.repeat(TRANSCRIPT_LIMIT.characters + 1), '2026-10-06T17:00:00Z');
    granola.pageTranscript(id, [[long]]);

    await expect(readGranolaNote(readerOf(granola.port), id)).resolves.toEqual(tooLong);
  });

  it('is too long for a transcript past the limit in pages, never asking for the page past it', async () => {
    const granola = fakeGranola({ notes });
    granola.pageTranscript(id, [[]]);
    let asked = 0;
    granola.port.getTranscriptPage = async () => ({ transcript: [], cursor: String((asked += 1)) });

    await expect(readGranolaNote(readerOf(granola.port), id)).resolves.toEqual(tooLong);
    expect(asked).toBe(TRANSCRIPT_LIMIT.pages);
  });

  it('marks a failed page of a transcript as one, and passes on what is not Granola’s', async () => {
    const granola = fakeGranola({ notes });
    granola.pageTranscript(id, [[], []]);
    granola.fail(`transcript:${id}`, { kind: 'timeout', message: 'slow' });

    await expect(readGranolaNote(readerOf(granola.port), id)).rejects.toMatchObject({
      failure: { kind: 'timeout', transcriptPage: true },
    });

    granola.port.getTranscriptPage = () => Promise.reject(new Error('a bug'));
    await expect(readGranolaNote(readerOf(granola.port), id)).rejects.toThrow('a bug');
  });

  it('calls a transcript that hands back the same page again malformed, as a page', async () => {
    const granola = fakeGranola({ notes });
    granola.pageTranscript(id, [[]]);
    let pages = 0;
    granola.port.getTranscriptPage = async () => {
      pages += 1;
      return { transcript: [], cursor: 'again' };
    };

    await expect(readGranolaNote(readerOf(granola.port), id)).rejects.toMatchObject({
      failure: { kind: 'malformed', transcriptPage: true },
    });
    expect(pages).toBe(2);
  });

  it('passes on a failure other than 413 for the note itself', async () => {
    const granola = fakeGranola({ notes });
    granola.fail(`note:${id}`, { kind: 'api_refused', status: 404, message: 'gone' });
    await expect(readGranolaNote(readerOf(granola.port), id)).rejects.toMatchObject({
      failure: { status: 404 },
    });
    expect(granola.calls).toHaveLength(1);
  });
});

import type { GranolaFailure, GranolaNote, GranolaNoteSummary } from '@dfai/domain';
import { GranolaError, type GranolaKeyStatus, type GranolaPort } from '../granola/ports.ts';

/** A call the fake Granola was asked, as a test reads them back. */
export type GranolaCall =
  | { readonly call: 'list'; readonly updatedAfter: string | null; readonly cursor: string | null }
  | { readonly call: 'note'; readonly id: string; readonly transcript: boolean }
  | { readonly call: 'transcript'; readonly id: string; readonly cursor: string | null };

/** What a failure is scripted against: the list, one note, or one note's transcript pages. */
export type GranolaCallKey = 'list' | `note:${string}` | `transcript:${string}`;

const keyOf = (call: GranolaCall): GranolaCallKey =>
  call.call === 'list' ? 'list' : `${call.call}:${call.id}`;

/** A turn as Granola's transcript sends it. */
export const granolaTurn = (text: string, at: string, attribution: 'me' | 'them' = 'them') => ({
  speaker: { source: attribution === 'me' ? 'microphone' : 'speaker', attribution },
  text,
  start_time: at,
  end_time: at,
});

/**
 * A note as `GET /v1/notes/{id}?include=transcript` sends it, its names made
 * up: Mara Quill's, with Tobias Fenn.
 */
export function granolaNote(
  id: string,
  {
    updatedAt,
    title = `Meeting ${id}`,
    ...more
  }: { updatedAt: string; title?: string } & Record<string, unknown>,
): GranolaNote {
  return {
    id,
    object: 'note',
    title,
    owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
    created_at: '2026-10-06T16:58:00Z',
    updated_at: updatedAt,
    deleted_at: null,
    web_url: `https://notes.granola.ai/d/${id}`,
    calendar_event: null,
    attendees: [{ name: 'Tobias Fenn', email: 'tobias.fenn@example.com' }],
    folder_membership: [],
    summary_text: 'Larkspur Payroll go-live moves a week.',
    summary_markdown: null,
    private_notes_text: null,
    private_notes_markdown: null,
    transcript: [
      granolaTurn('Morning, Tobias.', '2026-10-06T17:00:00Z', 'me'),
      granolaTurn('Morning. Go-live moves a week.', '2026-10-06T17:00:05Z'),
    ],
    ...more,
  };
}

const summaryOf = ({ id, title, updated_at }: GranolaNote): GranolaNoteSummary => ({
  id,
  object: 'note',
  title,
  updated_at,
});

/**
 * Granola in memory, for a vault's pull: it lists the notes it holds (those
 * updated after `updatedAfter`, a page at a time), gives each with its
 * transcript, and reads in pages a transcript set to be too large to send
 * inline (413). Failures scripted with `fail` answer the next calls to the
 * list, a note or a note's transcript, in order, before it answers again.
 * Every call is kept, to count.
 */
export function fakeGranola({
  notes = [],
  pageSize = 30,
}: { notes?: readonly GranolaNote[]; pageSize?: number } = {}) {
  const held = new Map(notes.map((note) => [note.id, note]));
  const pagedTranscripts = new Map<string, readonly (readonly unknown[])[]>();
  const failures = new Map<GranolaCallKey, GranolaFailure[]>();
  const calls: GranolaCall[] = [];
  let key: GranolaKeyStatus = { hasKey: true, lastRefusal: null };

  const answer = (call: GranolaCall) => {
    calls.push(call);
    const failure = failures.get(keyOf(call))?.shift();
    if (failure !== undefined) throw new GranolaError(failure);
  };
  const noteAt = (id: string) => {
    const note = held.get(id);
    if (note === undefined) {
      throw new GranolaError({ kind: 'api_refused', status: 404, message: 'Not found' });
    }
    return note;
  };

  const port: GranolaPort = {
    status: async () => key,
    setKey: async () => (key = { hasKey: true, lastRefusal: null }),
    forgetKey: async () => (key = { hasKey: false, lastRefusal: null }),
    listNotes: async ({ updatedAfter, cursor }) => {
      answer({ call: 'list', updatedAfter, cursor });
      const listed = [...held.values()]
        .filter((note) => updatedAfter === null || note.updated_at > updatedAfter)
        .map(summaryOf);
      const from = cursor === null ? 0 : Number(cursor);
      const next = from + pageSize;
      return {
        notes: listed.slice(from, next),
        unreadable: [],
        cursor: next < listed.length ? String(next) : null,
      };
    },
    getNote: async ({ id, transcript }) => {
      answer({ call: 'note', id, transcript });
      const note = noteAt(id);
      if (!transcript) return { ...note, transcript: null };
      if (pagedTranscripts.has(id)) {
        throw new GranolaError({ kind: 'api_refused', status: 413, message: 'Too large' });
      }
      return note;
    },
    getTranscriptPage: async ({ id, cursor }) => {
      answer({ call: 'transcript', id, cursor });
      noteAt(id);
      const pages = pagedTranscripts.get(id) ?? [noteAt(id).transcript ?? []];
      const at = cursor === null ? 0 : Number(cursor);
      return {
        transcript: pages[at] ?? [],
        cursor: at + 1 < pages.length ? String(at + 1) : null,
      };
    },
  };

  return {
    port,
    calls,
    /** The next calls to `key` fail with these, one each, in order. */
    fail(failing: GranolaCallKey, ...each: GranolaFailure[]) {
      failures.set(failing, [...(failures.get(failing) ?? []), ...each]);
    },
    /** The note's transcript is too large to send inline, and is read in these pages. */
    pageTranscript(id: string, pages: readonly (readonly unknown[])[]) {
      pagedTranscripts.set(id, pages);
    },
    /** How many calls of `kind` were made, for one note when `id` is given. */
    count(kind: GranolaCall['call'], id?: string) {
      return calls.filter(
        (call) => call.call === kind && (id === undefined || keyOf(call) === `${kind}:${id}`),
      ).length;
    },
  };
}

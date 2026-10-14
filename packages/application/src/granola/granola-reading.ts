import {
  transcriptCharacters,
  transcriptOverLimit,
  type GranolaNote,
  type GranolaNoteSummary,
  type GranolaUnreadableSummary,
} from '@atlas/domain';
import type { GranolaSend } from './granola-requests.ts';
import {
  GranolaError,
  type GranolaNotesPage,
  type GranolaPort,
  type GranolaTranscriptPage,
} from './ports.ts';

/** What reading from Granola needs: the port, the vault the calls are for, and the paced sender. */
export interface GranolaReader {
  readonly granola: GranolaPort;
  readonly vault: string;
  readonly send: GranolaSend;
}

/**
 * More pages of notes (thirty each: 60,000 notes) than anyone keeps; past it,
 * a list whose cursor never ends, and never repeats, is cut off. A cursor
 * that repeats is caught on the page it does.
 */
const MAX_LIST_PAGES = 2000;

const malformed = (message: string, transcriptPage = false) =>
  new GranolaError({ kind: 'malformed', message, ...(transcriptPage && { transcriptPage }) });

/**
 * Which unreadable listings are the same note: one id, listed twice, is one
 * note. With no id to tell them apart, those left out for the same reason
 * are taken as one.
 */
export const unreadableKey = ({ id, reason }: GranolaUnreadableSummary): string =>
  id === null ? `no id: ${reason}` : `id: ${id}`;

/** What the list of notes held: each note once, and those it named in a shape Atlas cannot read, each once too. */
export interface GranolaListing {
  readonly notes: readonly GranolaNoteSummary[];
  readonly unreadable: readonly GranolaUnreadableSummary[];
}

/**
 * Every note listed since `updatedAfter` (every note when null), each once.
 * Granola documents no order for its list, so the whole of it is read before
 * the pull decides anything by it.
 */
export async function listGranolaNotes(
  { granola, vault, send }: GranolaReader,
  updatedAfter: string | null,
): Promise<GranolaListing> {
  const listed = new Map<string, GranolaNoteSummary>();
  const unreadable = new Map<string, GranolaUnreadableSummary>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const from: string | null = cursor;
    const read: GranolaNotesPage = await send(() =>
      granola.listNotes({ vault, updatedAfter, cursor: from }),
    );
    for (const note of read.notes) listed.set(note.id, note);
    for (const summary of read.unreadable) {
      const key = unreadableKey(summary);
      if (!unreadable.has(key)) unreadable.set(key, summary);
    }
    if (read.cursor === null) {
      return { notes: [...listed.values()], unreadable: [...unreadable.values()] };
    }
    if (read.cursor === from) throw malformed('Granola sent the same page of notes again');
    cursor = read.cursor;
  }
  throw malformed(`the list of notes ran past ${MAX_LIST_PAGES} pages`);
}

const isTooLarge = (error: unknown) =>
  error instanceof GranolaError &&
  error.failure.kind === 'api_refused' &&
  error.failure.status === 413;

/**
 * A note as read: with its transcript, or — `tooLong` — without it, the
 * transcript being past the domain's limit. Either way the note is there to
 * name, and to link to in Granola.
 */
export type GranolaNoteRead =
  | { readonly tooLong: false; readonly note: GranolaNote }
  | { readonly tooLong: true; readonly note: GranolaNote & { readonly transcript: null } };

const transcriptTooLong = (note: GranolaNote): GranolaNoteRead => ({
  tooLong: true,
  note: { ...note, transcript: null },
});

/** Whether a transcript sent in one answer is past the limit: one page, however long. */
const inlineOverLimit = (transcript: readonly unknown[] | null) =>
  transcript !== null &&
  transcriptOverLimit({ characters: transcriptCharacters(transcript), pages: 1 });

/**
 * A note with its transcript, held to the domain's limit whether Granola
 * sent it inline or in pages. One too large for Granola to send inline (413)
 * is read a page at a time from its own endpoint.
 */
export async function readGranolaNote(reader: GranolaReader, id: string): Promise<GranolaNoteRead> {
  const { granola, vault, send } = reader;
  try {
    const note = await send(() => granola.getNote({ vault, id, transcript: true }));
    return inlineOverLimit(note.transcript) ? transcriptTooLong(note) : { tooLong: false, note };
  } catch (error) {
    if (!isTooLarge(error)) throw error;
  }
  const note = await send(() => granola.getNote({ vault, id, transcript: false }));
  const transcript = await readTranscriptPages(reader, id);
  return transcript === null
    ? transcriptTooLong(note)
    : { tooLong: false, note: { ...note, transcript } };
}

/** A failure reading a page of a transcript, marked as one. */
function pageFailure(error: unknown): unknown {
  if (!(error instanceof GranolaError)) return error;
  return new GranolaError({ ...error.failure, transcriptPage: true });
}

/** Every page of a note's transcript, in order; null once it passes the limit. */
async function readTranscriptPages(
  { granola, vault, send }: GranolaReader,
  id: string,
): Promise<readonly unknown[] | null> {
  const turns: unknown[] = [];
  let characters = 0;
  let cursor: string | null = null;
  for (let pages = 1; ; pages += 1) {
    if (transcriptOverLimit({ characters, pages })) return null;
    const from: string | null = cursor;
    const page: GranolaTranscriptPage = await send(() =>
      granola.getTranscriptPage({ vault, id, cursor: from }),
    ).catch((error: unknown) => {
      throw pageFailure(error);
    });
    // Not spread: a page is Granola's to size, and a long one would pass the engine's argument limit.
    for (const turn of page.transcript) turns.push(turn);
    characters += transcriptCharacters(page.transcript);
    if (transcriptOverLimit({ characters, pages })) return null;
    if (page.cursor === null) return turns;
    if (page.cursor === from)
      throw malformed('Granola sent the same page of a transcript again', true);
    cursor = page.cursor;
  }
}

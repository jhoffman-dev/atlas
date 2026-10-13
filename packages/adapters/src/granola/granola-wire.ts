import type { GranolaNote, GranolaNoteSummary } from '@atlas/domain';
import type { GranolaKeyStatus, GranolaNotesPage, GranolaTranscriptPage } from '@atlas/application';

/*
 * Granola's answers (OpenAPI: `ListNotesOutput`, `Note`,
 * `GetTranscriptOutput`) and the host's key status, read into the app's
 * types. What does not have the documented shape is null, for the caller to
 * call malformed: nothing is guessed at. Only what the pull reads is
 * checked; the rest of a note is the mapper's to read and refuse.
 */

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A note id the host will put in a path: `not_` and letters or digits, as
 * Granola spells them, and nothing a URL could read as anything else.
 */
const NOTE_ID = /^[A-Za-z0-9_-]+$/;

const isNoteId = (value: unknown): value is string =>
  typeof value === 'string' && NOTE_ID.test(value);

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/** The key status `granola_status` and the key commands answer with. */
export function keyStatusOf(value: unknown): GranolaKeyStatus | null {
  if (!isRecord(value) || typeof value['hasKey'] !== 'boolean') return null;
  const refusal = value['lastRefusal'];
  if (refusal !== null && refusal !== 401) return null;
  return { hasKey: value['hasKey'], lastRefusal: refusal };
}

/** Where the next page starts: Granola's cursor while it says there is more, else null. */
function nextCursor(body: JsonRecord): string | null | undefined {
  const { hasMore, cursor } = body;
  if (typeof hasMore !== 'boolean') return undefined;
  if (!hasMore) return null;
  return typeof cursor === 'string' && cursor !== '' ? cursor : undefined;
}

function summaryOf(value: unknown): GranolaNoteSummary | null {
  if (!isRecord(value)) return null;
  const { id, title, updated_at: updatedAt } = value;
  if (!isNoteId(id) || !isTextOrNull(title) || typeof updatedAt !== 'string') return null;
  return { ...value, id, title, updated_at: updatedAt };
}

/** A page of `GET /v1/notes`; null when any note in it is not one. */
export function notesPageOf(body: unknown): GranolaNotesPage | null {
  if (!isRecord(body) || !Array.isArray(body['notes'])) return null;
  const cursor = nextCursor(body);
  if (cursor === undefined) return null;
  const notes = body['notes'].map(summaryOf);
  if (notes.some((note) => note === null)) return null;
  return { notes: notes.filter((note) => note !== null), cursor };
}

/** The note `GET /v1/notes/{id}` answered for `id`; null when it is not that note. */
export function noteOf(body: unknown, id: string): GranolaNote | null {
  if (!isRecord(body) || body['id'] !== id) return null;
  const { title, updated_at: updatedAt, web_url: webUrl = null, transcript = null } = body;
  if (!isTextOrNull(title) || typeof updatedAt !== 'string' || !isTextOrNull(webUrl)) return null;
  if (transcript !== null && !Array.isArray(transcript)) return null;
  return {
    ...body,
    id,
    title,
    updated_at: updatedAt,
    web_url: webUrl,
    transcript: transcript as readonly unknown[] | null,
  };
}

/** A page of `GET /v1/notes/{id}/transcript`. */
export function transcriptPageOf(body: unknown): GranolaTranscriptPage | null {
  if (!isRecord(body) || !Array.isArray(body['transcript'])) return null;
  const cursor = nextCursor(body);
  if (cursor === undefined) return null;
  return { transcript: body['transcript'], cursor };
}

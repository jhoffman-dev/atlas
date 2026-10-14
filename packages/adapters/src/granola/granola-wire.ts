import type { GranolaNote, GranolaNoteSummary, GranolaUnreadableSummary } from '@atlas/domain';
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

/** A listed note read, or why it could not be: never what it says. */
type Listed =
  { readonly note: GranolaNoteSummary } | { readonly unreadable: GranolaUnreadableSummary };

function listedOf(value: unknown): Listed {
  if (!isRecord(value)) return { unreadable: { id: null, reason: 'it is not a note' } };
  const { id, title, updated_at: updatedAt } = value;
  const unreadable = (reason: string): Listed => ({
    unreadable: { id: typeof id === 'string' ? id : null, reason },
  });
  if (!isNoteId(id)) return unreadable('its id is not a Granola note id');
  if (!isTextOrNull(title)) return unreadable('its title is not text');
  if (typeof updatedAt !== 'string') return unreadable('its updated_at is not text');
  return { note: { ...value, id, title, updated_at: updatedAt } };
}

/**
 * A page of `GET /v1/notes`; null when the page itself is not one. A note in
 * it that is not as documented is set aside as unreadable, and the rest of
 * the page kept: one odd note must not cost the pull every other.
 */
export function notesPageOf(body: unknown): GranolaNotesPage | null {
  if (!isRecord(body) || !Array.isArray(body['notes'])) return null;
  const cursor = nextCursor(body);
  if (cursor === undefined) return null;
  const notes: GranolaNoteSummary[] = [];
  const unreadable: GranolaUnreadableSummary[] = [];
  for (const listed of body['notes'].map(listedOf)) {
    if ('note' in listed) notes.push(listed.note);
    else unreadable.push(listed.unreadable);
  }
  return { notes, unreadable, cursor };
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

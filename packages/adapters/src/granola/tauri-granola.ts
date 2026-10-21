import { invoke } from '@tauri-apps/api/core';
import { isGranolaFailureKind, type GranolaFailure } from '@dfai/domain';
import { GranolaError, type GranolaKeyStatus, type GranolaPort } from '@dfai/application';
import { keyStatusOf, noteOf, notesPageOf, transcriptPageOf } from './granola-wire.ts';

/** An API answer as the host hands it back: every status, with the key struck from the body. */
interface GranolaAnswer {
  readonly status: number;
  readonly body: string;
}

/** Granola's most per page of notes, and of a transcript's turns. */
const NOTES_PAGE_SIZE = '30';
const TRANSCRIPT_PAGE_SIZE = '100';

/**
 * A Granola command's rejection as the app's error. The host rejects with a
 * `{ kind, message }` it built; anything else — Tauri refusing the
 * arguments, say — is a request that could not be made.
 */
export function granolaErrorOf(rejection: unknown): GranolaError {
  if (typeof rejection === 'object' && rejection !== null && 'kind' in rejection) {
    const { kind, message } = rejection as Record<string, unknown>;
    if (isGranolaFailureKind(kind) && kind !== 'api_refused') {
      return new GranolaError({ kind, message: typeof message === 'string' ? message : '' });
    }
  }
  const message = rejection instanceof Error ? rejection.message : String(rejection);
  return new GranolaError({ kind: 'invalid', message });
}

async function throughHost<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (rejection) {
    throw granolaErrorOf(rejection);
  }
}

const malformed = (message: string) => new GranolaError({ kind: 'malformed', message });

async function keyCommand(
  command: string,
  args: Record<string, string>,
): Promise<GranolaKeyStatus> {
  const status = keyStatusOf(await throughHost(invoke<unknown>(command, args)));
  if (status === null) throw malformed('the host answered a key status DFAI cannot read');
  return status;
}

/** The JSON Granola answered with; a status other than 2xx is its refusal, with that status. */
async function callApi(
  vault: string,
  path: string,
  query: Readonly<Record<string, string>>,
): Promise<unknown> {
  const { status, body } = await throughHost(
    invoke<GranolaAnswer>('granola_request', { vault, path, query }),
  );
  if (status < 200 || status > 299) {
    const failure: GranolaFailure = {
      kind: 'api_refused',
      status,
      message: `Granola answered ${status}`,
    };
    throw new GranolaError(failure);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw malformed('Granola did not answer with JSON');
  }
}

/** The query with each parameter that has a value. */
const queryOf = (entries: Record<string, string | null>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(entries).filter((entry): entry is [string, string] => entry[1] !== null),
  );

/**
 * Granola through the host (ADR-0034). The host keeps the key and fixes
 * where it may go; what crosses here is whether a key is kept and the API's
 * answers, read into the app's types on this side.
 */
export const tauriGranola: GranolaPort = {
  status: ({ vault }) => keyCommand('granola_status', { vault }),
  setKey: ({ vault, key }) => keyCommand('granola_set_key', { vault, key }),
  forgetKey: ({ vault }) => keyCommand('granola_forget_key', { vault }),
  async listNotes({ vault, updatedAfter, cursor }) {
    const query = queryOf({ page_size: NOTES_PAGE_SIZE, updated_after: updatedAfter, cursor });
    const page = notesPageOf(await callApi(vault, '/v1/notes', query));
    if (page === null) throw malformed('the list of notes is not one DFAI can read');
    return page;
  },
  async getNote({ vault, id, transcript }) {
    const query = queryOf({ include: transcript ? 'transcript' : null });
    const note = noteOf(await callApi(vault, `/v1/notes/${id}`, query), id);
    if (note === null) throw malformed('the note is not one DFAI can read');
    return note;
  },
  async getTranscriptPage({ vault, id, cursor }) {
    const query = queryOf({ page_size: TRANSCRIPT_PAGE_SIZE, cursor });
    const page = transcriptPageOf(await callApi(vault, `/v1/notes/${id}/transcript`, query));
    if (page === null) throw malformed('the page of the transcript is not one DFAI can read');
    return page;
  },
};

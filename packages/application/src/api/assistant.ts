import { ABOUT_CHARACTERS } from '@dfai/domain';
import {
  AssistantEntityError,
  indexPassageFinder,
  readBrief,
  readMeetingQuotes,
  readOpenLoops,
  type AssistantReads,
} from '../assistant/index.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import { vaultQueryContext } from './atlas-query-answer.ts';
import type { ApiAssistantMeetings, ApiBrief, ApiOpenLoops } from './contract.ts';
import { countOf, dayParam, requiredText } from './fields.ts';
import { notePathFrom } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * The assistant's read tools (P32-04): a brief, open loops, and what was
 * said in meetings, about one Person, Company, Project, Area or Meeting note
 * named by `entity`. Each reads the page's linked sections from the index
 * and only the notes it answers with from the vault; none writes.
 */

const MEETINGS_LISTED = { field: 'limit', fallback: 10, max: 50 };

/** The note asked about, and what it is read with: the vault's types and notes, as the app has them. */
async function askedOf(request: VaultRequest) {
  const path = notePathFrom(requiredText(request.query, 'entity'), 'entity');
  const { types, notePaths } = await vaultQueryContext(request);
  const reads: AssistantReads = {
    index: request.index,
    fs: request.fs,
    markdown: request.markdown,
    types,
    notePaths,
  };
  return { path, reads };
}

/** A read as the API answers it: a page it cannot answer about refused, an index failure said without paths. */
async function answered<Answer>(request: VaultRequest, read: Promise<Answer>): Promise<Answer> {
  try {
    const answer = await read;
    // The index and the files answer for the vault open now: after a switch, this is another's.
    request.assertStillOpen();
    return answer;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    request.assertStillOpen();
    if (error instanceof AssistantEntityError) {
      throw new ApiError(error.reason === 'not_found' ? 'not_found' : 'invalid', error.message);
    }
    throw new ApiError('query_failed', `The index could not answer: ${messageWithoutPaths(error)}`);
  }
}

/** `GET /v1/assistant/brief?entity=&date=`: what to know about a page on a day. */
export async function briefRoute(request: VaultRequest): Promise<RouteResult> {
  const date = dayParam(request.query['date'], 'date');
  const { path, reads } = await askedOf(request);
  const brief: ApiBrief = await answered(
    request,
    readBrief({ reads, clock: request.clock, path, date }),
  );
  return { status: 200, body: { brief } };
}

/** `GET /v1/assistant/open-loops?entity=`: what is still open around a page. */
export async function openLoopsRoute(request: VaultRequest): Promise<RouteResult> {
  const { path, reads } = await askedOf(request);
  const openLoops: ApiOpenLoops = await answered(
    request,
    readOpenLoops({ reads, clock: request.clock, path }),
  );
  return { status: 200, body: { openLoops } };
}

/** `GET /v1/assistant/meetings?entity=&since=&about=&limit=`: who said what in a page's meetings. */
export async function assistantMeetingsRoute(request: VaultRequest): Promise<RouteResult> {
  const since = dayParam(request.query['since'], 'since');
  const about = aboutOf(request.query['about']);
  const limit = countOf(request.query['limit'], MEETINGS_LISTED);
  const { path, reads } = await askedOf(request);
  const meetings: ApiAssistantMeetings = await answered(
    request,
    readMeetingQuotes({
      reads,
      clock: request.clock,
      finder: indexPassageFinder(request.index),
      path,
      asked: { since, about, limit },
    }),
  );
  return { status: 200, body: meetings };
}

/** `about`, trimmed; null when left out or blank. Longer than a question's subject is refused. */
function aboutOf(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const about = raw.trim();
  if (about.length > ABOUT_CHARACTERS) {
    throw new ApiError('invalid', `about must be at most ${ABOUT_CHARACTERS} characters`);
  }
  return about === '' ? null : about;
}

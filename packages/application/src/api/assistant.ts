import { ABOUT_CHARACTERS } from '@dfai/domain';
import {
  AssistantEntityError,
  indexPassageFinder,
  readBrief,
  readMeetingQuotes,
  readOpenLoops,
  type AssistantReads,
} from '../assistant/index.ts';
import { ApiError } from './api-error.ts';
import { vaultQueryContext } from './atlas-query-answer.ts';
import type { ApiAssistantMeetings, ApiBrief, ApiOpenLoops } from './contract.ts';
import { countOf, dayParam, requiredText } from './fields.ts';
import { isApiNotePath, notePathFrom } from './paths.ts';
import { spelledAsVault } from './vault-spelling.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * The assistant's read tools (P32-04): a brief, open loops, and what was
 * said in meetings, about one Person, Company, Project, Area or Meeting note
 * named by `entity`. Each reads the page's linked sections from the index
 * and only the notes it answers with from the vault; none writes.
 */

const MEETINGS_LISTED = { field: 'limit', fallback: 10, max: 50 };

/**
 * The note asked about, spelt as the vault spells it (the notes route opens
 * `people/mara quill.md` on a case-insensitive disk too), and what it is read
 * with: the vault's types and notes, as the app has them.
 */
async function askedOf(request: VaultRequest) {
  const asked = notePathFrom(requiredText(request.query, 'entity'), 'entity');
  const path = await spelledAsVault({ fs: request.fs, asked, accepts: isApiNotePath });
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

/**
 * A read as the API answers it: a page it cannot answer about refused. An
 * index that fails mid-answer is not an error here — each read names what it
 * lost in `problems` and answers with the rest.
 */
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
    throw error;
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

/** `GET /v1/assistant/meetings?entity=&since=&until=&about=&limit=`: who said what in a page's meetings. */
export async function assistantMeetingsRoute(request: VaultRequest): Promise<RouteResult> {
  const since = dayParam(request.query['since'], 'since');
  const until = dayParam(request.query['until'], 'until');
  const about = aboutOf(request.query['about']);
  const limit = countOf(request.query['limit'], MEETINGS_LISTED);
  const { path, reads } = await askedOf(request);
  const meetingQuotes: ApiAssistantMeetings = await answered(
    request,
    readMeetingQuotes({
      reads,
      clock: request.clock,
      finder: indexPassageFinder(request.index),
      path,
      asked: { since, until, about, limit },
      selfName: request.ownerName,
    }),
  );
  return { status: 200, body: { meetingQuotes } };
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

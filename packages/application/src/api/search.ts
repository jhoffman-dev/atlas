import { createVaultPath, isArchivedPath, toSearchQuery } from '@atlas/domain';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import { countOf, queryFlag, requiredText } from './fields.ts';
import { isApiNotePath } from './paths.ts';
import type { SearchHit, SearchScope } from '../index/ports.ts';
import { searchScope } from '../index/search-notes.ts';
import type { ApiSearchHit } from './contract.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

const HITS = { fallback: 20, max: 100 };

interface Asked {
  readonly prepared: string;
  readonly limit: number;
  readonly scope: SearchScope;
}

/**
 * Full-text search, answered by the index as the search palette is. Hits the
 * API could not then read — Atlas's own notes in `.atlas` — are left out, and
 * so is the Archive unless `includeArchived` asks for it, when each archived
 * hit says so.
 */
export async function searchRoute(request: VaultRequest): Promise<RouteResult> {
  const text = requiredText(request.query, 'q');
  const limit = countOf(request.query['limit'], { field: 'limit', ...HITS });
  const includeArchived = queryFlag(request.query['includeArchived'], 'includeArchived');

  // A query with nothing searchable left once cleaned — only punctuation — matches nothing.
  const prepared = toSearchQuery(text);
  if (prepared === null) return { status: 200, body: { hits: [] } };

  const scope = searchScope({ includeArchived });
  const hits = await userSpaceHits(request, { prepared, limit, scope });
  return { status: 200, body: { hits: hits.map(toApiHit) } };
}

function toApiHit({ path, title, snippet }: SearchHit): ApiSearchHit {
  return { path, title, snippet, ...(isArchivedPath(path) && { archived: true as const }) };
}

/**
 * Up to `limit` hits the API could then read. Hits in `.atlas` are dropped
 * after the index has counted them, so it is asked for twice as many until
 * enough are left or it has no more to give.
 */
async function userSpaceHits(
  request: VaultRequest,
  { prepared, limit, scope }: Asked,
): Promise<readonly SearchHit[]> {
  for (let asked = limit; ; asked *= 2) {
    const found = await searchIndex(request, { prepared, limit: asked, scope });
    const hits = found.filter((hit) => isApiNotePath(createVaultPath(hit.path)));
    if (hits.length >= limit || found.length < asked) return hits.slice(0, limit);
  }
}

async function searchIndex(
  request: VaultRequest,
  { prepared, limit, scope }: Asked,
): Promise<readonly SearchHit[]> {
  try {
    return await request.index.search(prepared, limit, scope);
  } catch (error) {
    throw new ApiError(
      'query_failed',
      `The index could not run this search: ${messageWithoutPaths(error)}`,
    );
  }
}

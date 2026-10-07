import { defaultViewTab, typeViews, type ObjectType } from '@atlas/domain';
import { loadSidebarCatalog } from '../sidebar/load-catalog.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { ApiError } from './api-error.ts';
import type { ApiTypeView } from './contract.ts';
import { countOf, offsetOf } from './fields.ts';
import { decodeSegment } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

const PAGE = { fallback: 100, max: 500 };

/**
 * A type's views, in the order its tabs read (issue #11, ADR-0023). Which
 * views a type owns, their order and its default table are the domain's
 * (`typeViews`, `defaultViewTab`), read from the same catalogue the app's
 * tabs are drawn from, so the answer is the tabs as the app shows them.
 * Read-only: the views live in `.atlas/views`, which the API never writes.
 *
 * Paged by position, as `/v1/archive` is, not by path as `/v1/notes` is: tab
 * order is not path order, so a path cursor could not say where a page ends.
 */
export async function typeViewsRoute(request: VaultRequest): Promise<RouteResult> {
  const name = decodeSegment(request.nameParam, 'name');
  const limit = countOf(request.query['limit'], { field: 'limit', ...PAGE });
  const offset = offsetOf(request.query['offset']);
  const { fs, markdown, index } = request;
  const [types, catalog] = await Promise.all([
    loadObjectTypes({ fs, markdown }),
    loadSidebarCatalog({ fs, markdown, index }),
  ]);
  request.assertStillOpen();
  const type = types.find((candidate) => candidate.name === name);
  if (type === undefined)
    throw new ApiError('not_found', `No type is named ${JSON.stringify(name)}`);

  const owned = typeViews(catalog.savedViews, type.name);
  const views: ApiTypeView[] =
    owned.length > 0
      ? owned.map(({ path, title, layout, order }) => ({
          path,
          title,
          layout,
          order,
          virtual: false,
        }))
      : [defaultView(type, catalog.takenViewPaths)];
  const page = views.slice(offset, offset + limit);
  const next = offset + page.length < views.length ? offset + page.length : null;
  return { status: 200, body: { type: type.name, views: page, total: views.length, next } };
}

/**
 * The default table a type with no views shows, named and placed as the app
 * names it: against the same taken paths its tabs and its writes are given,
 * so the path is the one renaming or copying it would write.
 */
function defaultView(type: ObjectType, takenPaths: readonly string[]): ApiTypeView {
  const { path, title } = defaultViewTab({ type, takenPaths });
  return { path, title, layout: 'table', order: null, virtual: true };
}

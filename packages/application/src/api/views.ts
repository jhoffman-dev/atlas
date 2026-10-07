import {
  isDashboard,
  isSavedView,
  parseDashboard,
  parseQueryView,
  parseSavedView,
  parseSqlView,
  parseViewDisplay,
  splitFrontmatter,
  viewOrderOf,
  type SidebarEntry,
} from '@atlas/domain';
import { runDashboard } from '../dashboard/run-widget.ts';
import { loadSidebarCatalog } from '../sidebar/load-catalog.ts';
import { ApiError } from './api-error.ts';
import { answerAtlasQueryPage, vaultQueryContext } from './atlas-query-answer.ts';
import type { ApiRows, ApiSuccessBody, ApiView } from './contract.ts';
import { bodyObject, optionalBoolean } from './fields.ts';
import { readNote } from './note-io.ts';
import { isApiViewPath, viewPathFromUrl } from './paths.ts';
import { runSql } from '../query/run-sql.ts';
import { runSavedView } from './view-groups.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';
import { spelledAsVault } from './vault-spelling.ts';

/**
 * The saved views and dashboards, found where the sidebar finds them. Today
 * and Inbox are listed too, first, as the sidebar lifts them: they are views,
 * run by their paths like any other.
 */
export async function viewsRoute(request: VaultRequest): Promise<RouteResult> {
  const { fs, markdown, index } = request;
  const catalog = await loadSidebarCatalog({ fs, markdown, index });
  const savedViews = [...catalog.quick.map((view) => view.entry), ...catalog.views];
  const entries = [...savedViews, ...catalog.dashboards];
  const files = await fs.readNotes(entries.map((entry) => entry.path));
  const properties = new Map(
    files.map((file) => [
      file.path,
      markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter),
    ]),
  );

  const views: ApiView[] = [
    ...savedViews.map((entry) => toApiView(entry, properties.get(entry.path) ?? {})),
    ...catalog.dashboards.map((entry) => ({
      path: entry.path,
      title: entry.title,
      kind: 'dashboard' as const,
      type: null,
      layout: null,
      groupBy: null,
      subGroupBy: null,
      order: null,
    })),
  ];
  return { status: 200, body: { views } };
}

/**
 * Runs a saved view for its rows, or a dashboard for every widget's answer.
 * The index belongs to whichever vault is open now, so an answer read across a
 * switch is refused rather than handed back as this vault's.
 */
export async function runViewRoute(request: VaultRequest): Promise<RouteResult> {
  const body = await runView(request);
  request.assertStillOpen();
  return { status: 200, body };
}

async function runView(request: VaultRequest): Promise<ApiSuccessBody> {
  const path = await spelledAsVault({
    fs: request.fs,
    asked: viewPathFromUrl(request.pathParam),
    accepts: isApiViewPath,
  });
  const { text } = await readNote(request, path);
  const properties = request.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);

  if (isDashboard(properties)) {
    const widgets = await runDashboard({
      index: request.index,
      widgets: parseDashboard(properties),
      ...(await vaultQueryContext(request)),
    });
    return { widgets };
  }
  if (!isSavedView(properties)) {
    throw new ApiError('not_found', `${path} is not a view or a dashboard`);
  }
  const sql = parseSqlView(properties);
  if (sql !== null) return runSqlView(request, sql);
  const atlasQuery = parseQueryView(properties);
  if (atlasQuery !== null) return runQueryView(request, atlasQuery);
  const query = parseSavedView(properties);
  if (query === null) throw new ApiError('invalid', `${path} does not say which type it lists`);
  const includeArchived = includeArchivedIn(request.body);
  return runSavedView(request, { query, display: parseViewDisplay(properties), includeArchived });
}

/** Whether a run asked for archived notes too; a run may send no body at all. */
function includeArchivedIn(body: unknown): boolean {
  return body === null ? false : (optionalBoolean(bodyObject(body), 'includeArchived') ?? false);
}

/**
 * A query view's rows, as the app runs it (ADR-0019), up to its own LIMIT —
 * saying so when that LIMIT cut them short. Its text says whether archived
 * notes are included, so a run's `includeArchived` does not apply.
 */
async function runQueryView(request: VaultRequest, text: string): Promise<ApiRows> {
  return (await answerAtlasQueryPage(request, text, null)).rows;
}

/** A SQL view's rows, run through the same read-only path as the app runs them. */
async function runSqlView(request: VaultRequest, sql: string) {
  try {
    const result = await runSql({ index: request.index, sql });
    return { ...result, sql };
  } catch (error) {
    throw new ApiError('query_failed', error instanceof Error ? error.message : String(error));
  }
}

function toApiView(entry: SidebarEntry, properties: Readonly<Record<string, unknown>>): ApiView {
  const { layout, groupBy, subGroupBy } = parseViewDisplay(properties);
  return {
    path: entry.path,
    title: entry.title,
    kind: 'view',
    type: parseSavedView(properties)?.type ?? null,
    layout,
    groupBy,
    subGroupBy,
    order: viewOrderOf(properties),
  };
}

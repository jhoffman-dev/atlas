import {
  noteContextText,
  rowsContextText,
  CONTEXT_ROWS,
  type ChatContext,
  type VaultPath,
} from '@atlas/domain';
import {
  routeApiRequest,
  type ApiRequest,
  type ApiRouterDeps,
  type ApiView,
} from '../api/index.ts';

/** What the window is showing, as the chat can be told it. */
export type ChatWindow =
  | { readonly kind: 'path'; readonly path: VaultPath }
  | { readonly kind: 'query'; readonly text: string }
  | { readonly kind: 'none' };

/**
 * What the chat opens knowing (P27-02): the note in the focused pane, a view's
 * first rows, a dashboard's widgets, or the query being written — read through
 * the same routes the chat's tools use, so the context is what the model could
 * have asked for itself. Null when there is nothing to tell it, or it could
 * not be read.
 */
export async function captureWindowContext({
  window,
  api,
}: {
  window: ChatWindow;
  api: ApiRouterDeps;
}): Promise<ChatContext | null> {
  if (window.kind === 'none') return null;
  if (window.kind === 'query') return queryContext(window.text, api);
  const views = await ask(api, { method: 'GET', path: '/v1/views' });
  const view = (views as { views?: readonly ApiView[] } | null)?.views?.find(
    (candidate) => candidate.path === window.path,
  );
  return view === undefined ? noteContext(window.path, api) : viewContext(view, api);
}

async function noteContext(path: VaultPath, api: ApiRouterDeps): Promise<ChatContext | null> {
  const answer = await ask(api, { method: 'GET', path: `/v1/notes/${encodeURIComponent(path)}` });
  const note = (
    answer as { note?: { title: string; properties: Record<string, unknown>; body: string } } | null
  )?.note;
  if (note === undefined) return null;
  return { kind: 'note', title: note.title, path, text: noteContextText(note) };
}

async function viewContext(view: ApiView, api: ApiRouterDeps): Promise<ChatContext | null> {
  const answer = await ask(api, {
    method: 'POST',
    path: `/v1/views/${encodeURIComponent(view.path)}/run`,
    body: {},
  });
  if (answer === null) return null;
  const path = view.path as VaultPath;
  if (view.kind === 'dashboard') {
    const widgets = JSON.stringify((answer as { widgets?: unknown }).widgets ?? []);
    return { kind: 'dashboard', title: view.title, path, text: `Widgets: ${widgets}` };
  }
  const rows = answer as { columns: string[]; rows: unknown[][]; sql: string };
  return {
    kind: 'view',
    title: view.title,
    path,
    text: rowsContextText({ source: rows.sql, columns: rows.columns, rows: rows.rows }),
  };
}

async function queryContext(text: string, api: ApiRouterDeps): Promise<ChatContext | null> {
  if (text.trim() === '') return null;
  const answer = await ask(api, {
    method: 'POST',
    path: '/v1/atlas-query',
    body: { query: text, limit: CONTEXT_ROWS + 1 },
  });
  const rows = answer as { columns: string[]; rows: unknown[][] } | null;
  const shown =
    rows === null
      ? `Query: ${text}\n\n(It does not run yet.)`
      : rowsContextText({ source: text, columns: rows.columns, rows: rows.rows });
  return { kind: 'query', title: 'Query', path: null, text: shown };
}

/** The route's answer, or null when it refused: a context that cannot be read is left out. */
async function ask(
  api: ApiRouterDeps,
  call: Pick<ApiRequest, 'method' | 'path'> & { body?: unknown },
): Promise<unknown> {
  const response = await routeApiRequest(
    {
      id: 'chat-context',
      query: {},
      body: call.body ?? null,
      method: call.method,
      path: call.path,
    },
    api,
  );
  return response.status >= 400 ? null : response.body;
}

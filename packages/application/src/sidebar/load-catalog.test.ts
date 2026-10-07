import { describe, expect, it, vi } from 'vitest';
import { compileSidebarQuery, createVaultPath, type VaultEntry } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { QueryResult } from '../index/ports.ts';
import { loadSidebarCatalog } from './load-catalog.ts';

/** Frontmatter as one JSON object, which is enough to classify a note. */
const markdown = {
  frontmatterProperties: (frontmatter: string | null) =>
    frontmatter === null
      ? {}
      : (JSON.parse(frontmatter.replace(/^---\n|\n---\n?$/g, '')) as object),
  plainText: (body: string) => body,
  textRanges: (body: string) => [{ start: 0, end: body.length }],
  parseBody: () => ({ blocks: [], doc: { type: 'doc', content: [] } }),
  serializeBody: ({ originalBody }: { originalBody: string }) => originalBody,
  updateFrontmatter: () => '',
} as unknown as MarkdownPort;

const noteWith = (properties: Record<string, unknown>, body = 'Some text.\n'): string =>
  `---\n${JSON.stringify(properties)}\n---\n\n${body}`;

/** A vault whose `.atlas` folder holds these files, and nothing else. */
function atlasVault(files: Record<string, string>) {
  const entry = (path: string, kind: VaultEntry['kind']): VaultEntry =>
    ({ kind, name: path.split('/').at(-1) ?? path, path: createVaultPath(path) }) as VaultEntry;

  return fakeVaultFs({
    listDirectory: async (folder) => {
      const children = new Map<string, VaultEntry>();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(`${folder}/`)) continue;
        const rest = path.slice(folder.length + 1);
        const [head] = rest.split('/');
        const child = `${folder}/${head ?? ''}`;
        children.set(child, entry(child, rest.includes('/') ? 'directory' : 'file'));
      }
      if (children.size === 0 && folder !== '.atlas') throw new Error('no such directory');
      return [...children.values()];
    },
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = files[path];
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
}

/** The title the index stores for a note that gives no other: its filename. */
const fileTitle = (path: string) => path.split('/').at(-1)?.replace(/\.md$/, '') ?? path;

/**
 * An index that answers the sidebar's query with these property rows, each
 * carrying the note's indexed title — its filename unless a fourth item says.
 */
function indexWith(rows: readonly (readonly [string, string, string, string?])[]) {
  const query = vi.fn(async (): Promise<QueryResult> => ({
    columns: ['path', 'key', 'value', 'title'],
    rows: rows.map(([path, key, value, title]) => [path, key, value, title ?? fileTitle(path)]),
    truncated: false,
  }));
  return { index: fakeIndexPort({ query }), query };
}

describe('loadSidebarCatalog', () => {
  it('has nothing to show in an empty vault', async () => {
    const { index } = indexWith([]);
    const catalog = await loadSidebarCatalog({ fs: fakeVaultFs(), markdown, index });
    expect(catalog).toEqual({
      views: [],
      dashboards: [],
      favorites: [],
      quick: [],
      savedViews: [],
      queryViews: [],
      takenViewPaths: [],
    });
  });

  it('finds the views and dashboards inside .atlas, which the index never reads', async () => {
    const { index } = indexWith([]);
    const fs = atlasVault({
      '.atlas/views/Board.md': noteWith({ atlas: 'view', type: 'task' }),
      '.atlas/dashboards/Progress.md': noteWith({ atlas: 'dashboard' }),
      '.atlas/types/task.md': noteWith({ name: 'task' }),
    });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.views.map((view) => view.title)).toEqual(['Board']);
    expect(catalog.dashboards.map((one) => one.path)).toEqual(['.atlas/dashboards/Progress.md']);
  });

  it('lists a saved Atlas query as a view, and among the queries its tabs offer', async () => {
    const { index } = indexWith([]);
    const fs = atlasVault({
      '.atlas/views/Open work.md': noteWith({
        atlas: 'view',
        layout: 'board',
        query: 'FROM task GROUP BY status',
      }),
      '.atlas/views/Board.md': noteWith({ atlas: 'view', type: 'task' }),
    });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.views.map((view) => view.title)).toEqual(['Board', 'Open work']);
    expect(catalog.queryViews).toEqual([
      { path: '.atlas/views/Open work.md', title: 'Open work', layout: 'board' },
    ]);
    expect(catalog.savedViews.map((view) => view.title)).toEqual(['Board']);
  });

  /**
   * A template carries the frontmatter of what it makes — the Dashboard
   * template says `atlas: dashboard` — but it is not a dashboard, and listing
   * it put a "Dashboard" row under Dashboards that opened a page of docs.
   */
  it('lists no template as a view or a dashboard, from either place', async () => {
    const { index } = indexWith([
      ['.atlas/templates/Board.md', 'atlas', 'view'],
      ['.atlas/templates/Board.md', 'favorite', 'true'],
    ]);
    const fs = atlasVault({
      '.atlas/templates/Dashboard.md': noteWith({ atlas: 'dashboard' }),
      '.atlas/templates/Board.md': noteWith({ atlas: 'view', type: 'task', favorite: true }),
      '.atlas/dashboards/Progress.md': noteWith({ atlas: 'dashboard' }),
    });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.dashboards.map((entry) => entry.title)).toEqual(['Progress']);
    expect(catalog.views).toEqual([]);
    expect(catalog.savedViews).toEqual([]);
    // Starring is still yours to do: a starred template is a favourite like any note.
    expect(catalog.favorites.map((entry) => entry.title)).toEqual(['Board']);
  });

  it('finds a view kept anywhere else, because the index knows its mark', async () => {
    const { index } = indexWith([['Plans/Sprint.md', 'atlas', 'view']]);
    const catalog = await loadSidebarCatalog({ fs: fakeVaultFs(), markdown, index });
    expect(catalog.views.map((view) => view.path)).toEqual(['Plans/Sprint.md']);
  });

  it('asks the index for the marks rather than walking the vault', async () => {
    const { index, query } = indexWith([]);
    await loadSidebarCatalog({ fs: fakeVaultFs(), markdown, index });
    const { sql, parameters } = compileSidebarQuery();
    expect(query).toHaveBeenCalledWith(sql, parameters);
  });

  it('collects favourites from both places, alphabetically, listing each once', async () => {
    const { index } = indexWith([
      ['zebra.md', 'favorite', 'true'],
      ['Apple.md', 'favorite', 'true'],
    ]);
    const fs = atlasVault({
      '.atlas/views/Board.md': noteWith({ atlas: 'view', favorite: true }),
    });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.favorites.map((entry) => entry.title)).toEqual(['Apple', 'Board', 'zebra']);
    // A favourited view is still a view.
    expect(catalog.views.map((view) => view.title)).toEqual(['Board']);
  });

  it('names each entry the way its page is titled, from the index and from .atlas', async () => {
    const { index } = indexWith([
      ['docs/adr/0002-e2e.md', 'favorite', 'true', 'E2E runs in WebKit'],
    ]);
    const fs = atlasVault({
      '.atlas/views/Board.md': noteWith({ atlas: 'view' }, '# A heading a view never shows\n'),
      '.atlas/views/Roadmap.md': noteWith({ atlas: 'view', title: 'The road' }, '# Ignored\n'),
    });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.favorites.map((entry) => entry.title)).toEqual(['E2E runs in WebKit']);
    expect(catalog.views.map((view) => view.title)).toEqual(['Board', 'The road']);
  });

  it('names an entry by its filename when the index answers without a title', async () => {
    const index = fakeIndexPort({
      query: async () => ({
        columns: ['path', 'key', 'value'],
        rows: [['Notes/Plan.md', 'favorite', 'true']],
        truncated: false,
      }),
    });
    const catalog = await loadSidebarCatalog({ fs: fakeVaultFs(), markdown, index });
    expect(catalog.favorites.map((entry) => entry.title)).toEqual(['Plan']);
  });

  it('leaves out a note whose favourite mark is not set', async () => {
    const { index } = indexWith([['draft.md', 'favorite', 'false']]);
    const catalog = await loadSidebarCatalog({ fs: fakeVaultFs(), markdown, index });
    expect(catalog.favorites).toEqual([]);
  });

  it('takes what is on disk over what the index remembers', async () => {
    // The index is refreshed after the file is written, so a mark it still
    // carries for an `.atlas` note is the stale one.
    const { index } = indexWith([['.atlas/views/Board.md', 'favorite', 'true']]);
    const fs = atlasVault({ '.atlas/views/Board.md': noteWith({ atlas: 'view' }) });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.favorites).toEqual([]);
  });

  it('shows what the files say when the index cannot answer', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error('the index is not open');
      },
    });
    const fs = atlasVault({ '.atlas/views/Board.md': noteWith({ atlas: 'view' }) });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.views.map((view) => view.title)).toEqual(['Board']);
  });

  it('survives a vault with no .atlas folder', async () => {
    const { index } = indexWith([['note.md', 'favorite', 'true']]);
    const fs = fakeVaultFs({
      listDirectory: async () => {
        throw new Error('no such directory');
      },
    });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.favorites.map((entry) => entry.title)).toEqual(['note']);
  });

  it('ignores a note in .atlas with no frontmatter at all', async () => {
    const { index } = indexWith([]);
    const fs = atlasVault({ '.atlas/views/README.md': '# How views work\n' });

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    // Not a view, but its file is there: a view of that name could not be written.
    expect(catalog).toEqual({
      views: [],
      dashboards: [],
      favorites: [],
      quick: [],
      savedViews: [],
      queryViews: [],
      takenViewPaths: ['.atlas/views/README.md'],
    });
  });

  it('counts as taken every file in .atlas/views, the lifted views and every view elsewhere', async () => {
    const fs = atlasVault({
      '.atlas/views/Inbox.md': noteWith({ atlas: 'view', type: 'task' }),
      '.atlas/views/Scratch.md': '# Not a view\n',
      '.atlas/views/notes.txt': 'Not markdown either.',
    });
    const { index } = indexWith([['Work/Mine.md', 'atlas', 'view']]);

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect([...catalog.takenViewPaths].sort()).toEqual([
      '.atlas/views/Inbox.md',
      '.atlas/views/Scratch.md',
      '.atlas/views/notes.txt',
      'Work/Mine.md',
    ]);
  });

  it('stops walking .atlas rather than following it down for ever', async () => {
    const listDirectory = vi.fn(async (folder: string) => [
      { kind: 'directory' as const, name: 'down', path: createVaultPath(`${folder}/down`) },
    ]);
    const { index } = indexWith([]);

    await loadSidebarCatalog({ fs: fakeVaultFs({ listDirectory }), markdown, index });

    expect(listDirectory.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('ignores a row that names neither a note nor a property', async () => {
    const { index } = indexWith([
      ['', 'favorite', 'true'],
      ['note.md', '', 'true'],
    ]);
    const catalog = await loadSidebarCatalog({ fs: fakeVaultFs(), markdown, index });
    expect(catalog.favorites).toEqual([]);
  });

  it('draws each entry by what it is: a board as a board, a dashboard as a chart', async () => {
    const fs = atlasVault({
      '.atlas/views/Board.md': noteWith({ atlas: 'view', layout: 'board', groupBy: 'status' }),
      '.atlas/dashboards/Progress.md': noteWith({ atlas: 'dashboard', favorite: true }),
    });
    const { index } = indexWith([['Plain.md', 'favorite', 'true']]);

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.views.map((view) => view.icon)).toEqual(['board']);
    expect(catalog.dashboards.map((dashboard) => dashboard.icon)).toEqual(['chart']);
    // A favourite keeps the icon of what it is.
    expect(catalog.favorites.map((entry) => [entry.title, entry.icon])).toEqual([
      ['Plain', 'doc'],
      ['Progress', 'chart'],
    ]);
  });

  it('draws a view the index found by the layout the index knows', async () => {
    const { index } = indexWith([
      ['Plans/Sprint.md', 'atlas', 'view'],
      ['Plans/Sprint.md', 'layout', 'calendar'],
      ['Plans/Sprint.md', 'dateKey', 'due'],
    ]);
    const catalog = await loadSidebarCatalog({ fs: fakeVaultFs(), markdown, index });
    expect(catalog.views.map((view) => view.icon)).toEqual(['calendar']);
  });

  it('knows what every view lists, from either place, the lifted ones included', async () => {
    const fs = atlasVault({
      '.atlas/views/Inbox.md': noteWith({ atlas: 'view', type: 'task', layout: 'list' }),
      '.atlas/views/Board.md': noteWith({
        atlas: 'view',
        type: 'task',
        layout: 'board',
        groupBy: 'status',
      }),
      '.atlas/views/Untyped.md': noteWith({ atlas: 'view' }),
      '.atlas/dashboards/Progress.md': noteWith({ atlas: 'dashboard', type: 'task' }),
    });
    const { index } = indexWith([
      ['Plans/Sprint.md', 'atlas', 'view'],
      ['Plans/Sprint.md', 'type', 'event'],
      ['Plans/Sprint.md', 'layout', 'calendar'],
      ['Plans/Sprint.md', 'dateKey', 'date'],
    ]);

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(
      catalog.savedViews
        .map((view) => [view.title, view.type, view.layout])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ['Board', 'task', 'board'],
      ['Inbox', 'task', 'list'],
      ['Sprint', 'event', 'calendar'],
    ]);
  });

  it('lifts Today and Inbox out of the views, when the vault has them', async () => {
    const fs = atlasVault({
      '.atlas/views/Inbox.md': noteWith({ atlas: 'view' }),
      '.atlas/views/Board.md': noteWith({ atlas: 'view' }),
    });
    const { index } = indexWith([]);

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.quick.map((view) => [view.id, view.entry.title])).toEqual([['inbox', 'Inbox']]);
    // Listed once: at the top, and not again under Views.
    expect(catalog.views.map((view) => view.title)).toEqual(['Board']);
  });

  it('keeps a lifted view among the favourites when it is starred', async () => {
    const fs = atlasVault({ '.atlas/views/Today.md': noteWith({ atlas: 'view', favorite: true }) });
    const { index } = indexWith([]);

    const catalog = await loadSidebarCatalog({ fs, markdown, index });

    expect(catalog.views).toEqual([]);
    expect(catalog.favorites.map((entry) => entry.title)).toEqual(['Today']);
  });
});

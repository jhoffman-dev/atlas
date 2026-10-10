import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createVaultPath } from '@atlas/domain';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriIndex } = await import('./tauri-index.ts');

describe('tauriIndex', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it('opens the index, and passes on whether the host had to make it', async () => {
    invoke.mockResolvedValue({ fresh: true });
    await expect(tauriIndex.open()).resolves.toEqual({ fresh: true });
    expect(invoke).toHaveBeenCalledWith('index_open');
  });

  it('clears the index', async () => {
    await tauriIndex.clear();
    expect(invoke).toHaveBeenCalledWith('index_clear');
  });

  it('asks for the manifest', async () => {
    invoke.mockResolvedValue([{ path: 'a.md', modified: 1, size: 2 }]);
    await expect(tauriIndex.manifest()).resolves.toEqual([{ path: 'a.md', modified: 1, size: 2 }]);
    expect(invoke).toHaveBeenCalledWith('index_manifest');
  });

  it('sends notes to be indexed', async () => {
    const notes = [
      {
        path: 'a.md',
        title: 'A',
        modified: 1,
        size: 2,
        type: 'meeting',
        digest: '1a2b3c4d',
        body: 'text',
        summary: 'text',
        properties: [],
        links: [],
        tags: [{ key: 'idea', name: 'Idea' }],
        relations: [
          { key: 'owner', index: 0, target: 'Julie', name: 'julie', path: 'people/Julie.md' },
        ],
        blocks: [{ id: 'f3k9x2', text: 'The plan' }],
        checks: [{ done: true, text: 'Book the hall' }],
        progress: 100,
      },
    ];
    await tauriIndex.put(notes);
    expect(invoke).toHaveBeenCalledWith('index_put', { notes });
  });

  it('removes notes by path', async () => {
    await tauriIndex.remove([createVaultPath('a.md')]);
    expect(invoke).toHaveBeenCalledWith('index_remove', { paths: ['a.md'] });
  });

  it('runs a search with its limit', async () => {
    invoke.mockResolvedValue([]);
    await tauriIndex.search('"week"*', 20);
    expect(invoke).toHaveBeenCalledWith('index_search', {
      query: '"week"*',
      limit: 20,
      skipPrefix: null,
    });
  });

  it('hands the host the prefix a search leaves out', async () => {
    invoke.mockResolvedValue([]);
    await tauriIndex.search('"week"*', 20, { skipPrefix: 'archive/' });
    expect(invoke).toHaveBeenCalledWith('index_search', {
      query: '"week"*',
      limit: 20,
      skipPrefix: 'archive/',
    });
  });

  it('asks for the notes of a type', async () => {
    invoke.mockResolvedValue([{ path: 'a.md', title: 'Ada' }]);
    await expect(tauriIndex.notesOfType('person')).resolves.toEqual([
      { path: 'a.md', title: 'Ada' },
    ]);
    expect(invoke).toHaveBeenCalledWith('index_notes_of_type', { type: 'person' });
  });

  it('asks for backlinks', async () => {
    invoke.mockResolvedValue(['b.md']);
    await expect(tauriIndex.backlinks(createVaultPath('a.md'))).resolves.toEqual(['b.md']);
    expect(invoke).toHaveBeenCalledWith('index_backlinks', { path: 'a.md' });
  });

  it('rebuilds the views for the types it is given', async () => {
    const types = [
      { name: 'task', columns: [{ key: 'status', kind: 'select', many: false }], progress: true },
    ];
    await tauriIndex.rebuildViews(types);
    expect(invoke).toHaveBeenCalledWith('index_rebuild_views', { types });
  });

  it('runs a query with its parameters bound', async () => {
    invoke.mockResolvedValue({ columns: ['title'], rows: [['A']], truncated: false });
    const result = await tauriIndex.query('SELECT "title" FROM "v_task" LIMIT ?', [50]);
    expect(invoke).toHaveBeenCalledWith('index_query', {
      sql: 'SELECT "title" FROM "v_task" LIMIT ?',
      parameters: [50],
    });
    expect(result.rows).toEqual([['A']]);
  });

  it('reports the index statistics', async () => {
    invoke.mockResolvedValue({ notes: 3, properties: 4, links: 5 });
    await expect(tauriIndex.stats()).resolves.toEqual({ notes: 3, properties: 4, links: 5 });
  });

  it('turns a host refusal into a real error', async () => {
    invoke.mockImplementation(() => Promise.reject('the index is not open'));
    await expect(tauriIndex.stats()).rejects.toThrow('the index is not open');
  });
});

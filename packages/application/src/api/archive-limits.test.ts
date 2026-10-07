/**
 * The limits of the one move the API makes (A20-06, ADR-0016): it never saves
 * someone's unsaved typing, it names every note a batch left unfinished, an
 * edited stamp cannot steer where a note goes back to, and nothing is filed
 * deeper than the vault is read.
 */

import { describe, expect, it } from 'vitest';
import type { VaultPath } from '@atlas/domain';
import { VAULT_WALK_DEPTH } from '@atlas/domain';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';

const post = (route: string, paths: unknown) => ({
  method: 'POST' as const,
  path: route,
  body: { paths },
});

/** A fixture whose panes hold `dirty` with unsaved typing. */
function withTyping(api: ReturnType<typeof apiFixture>, dirty: readonly string[]) {
  const flushed: (readonly VaultPath[])[] = [];
  api.deps = {
    ...api.deps,
    movingNotes: {
      ...api.deps.movingNotes,
      state: (path) => (dirty.includes(path) ? 'dirty' : 'closed'),
      flush: async (paths) => void flushed.push(paths),
    },
  };
  return flushed;
}

describe('the API leaves unsaved typing alone (ADR-0016)', () => {
  it('does not move a note being typed in, and lists it as unsaved_in_app', async () => {
    const api = apiFixture({ files: { 'A.md': 'a\n', 'B.md': 'b\n' } });
    const flushed = withTyping(api, ['A.md']);

    const response = await api.send(post('/v1/archive', ['A.md', 'B.md']));

    expect(bodyOf(response)['moves']).toEqual([{ from: 'B.md', to: 'Archive/B.md' }]);
    expect(bodyOf(response)['failed']).toEqual([
      { path: 'A.md', reason: expect.any(String), code: 'unsaved_in_app' },
    ]);
    expect(api.files.has('A.md')).toBe(true);
    expect(flushed.flat()).toEqual([]);
  });

  it('does not rewrite a linking note being typed in, and names it', async () => {
    const api = apiFixture({
      files: { 'Projects/X.md': 'x\n', 'Linker.md': 'See [[Projects/X]].\n' },
    });
    const flushed = withTyping(api, ['Linker.md']);

    const response = await api.send(post('/v1/archive', ['Projects/X.md']));

    expect(api.files.get('Linker.md')?.text).toBe('See [[Projects/X]].\n');
    expect(bodyOf(response)['failed']).toEqual([
      { path: 'Linker.md', reason: expect.any(String), code: 'unsaved_in_app' },
    ]);
    expect(flushed.flat()).toEqual([]);
  });
});

describe('a link the API could not rewrite (A20-06)', () => {
  it('names the linking note, not only the note that moved', async () => {
    const api = apiFixture({
      files: { 'Projects/X.md': 'x\n', 'Stuck.md': 'See [[Projects/X]].\n' },
    });
    const writing = api.deps.fs.writeTextFile;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        writeTextFile: async (args) => {
          if (args.path === 'Stuck.md') throw new Error('the note changed on disk');
          return writing(args);
        },
      },
    };

    const response = await api.send(post('/v1/archive', ['Projects/X.md']));

    expect(bodyOf(response)['failed']).toEqual([
      { path: 'Stuck.md', reason: expect.stringContaining('changed on disk') },
    ]);
  });
});

describe('an edited stamp cannot steer where a note goes back to (A20-06)', () => {
  it('puts it back where the Archive holds it, making no folder the stamp named', async () => {
    const api = apiFixture({
      files: {
        'Archive/Projects/X.md': '---\narchivedFrom: Elsewhere/Deep/Y.txt\n---\nBody\n',
      },
    });
    const patched = await api.send({
      method: 'PATCH',
      path: `/v1/notes/${encoded('Archive/Projects/X.md')}/properties`,
      body: { set: { archivedFrom: 'Hidden/Place.md' } },
    });

    expect(patched.status).toBe(200);
    const response = await api.send(post('/v1/unarchive', ['Archive/Projects/X.md']));

    expect(bodyOf(response)['moves']).toEqual([
      { from: 'Archive/Projects/X.md', to: 'Projects/X.md' },
    ]);
    expect([...api.files.keys()].some((path) => /Elsewhere|Hidden/.test(path))).toBe(false);
  });

  it('reaches no note under a folder the walk prunes, in any case', async () => {
    const api = apiFixture({ files: { 'Node_Modules/X.md': 'x\n' } });

    const response = await api.send(post('/v1/archive', ['Node_Modules/X.md']));

    expect(bodyOf(response)['moves']).toEqual([]);
    expect(api.files.has('Node_Modules/X.md')).toBe(true);
  });
});

describe('archiving past the depth the vault is read to (A20-06)', () => {
  it('refuses a note the Archive would file where the walk no longer reaches', async () => {
    const deep = `${Array.from({ length: VAULT_WALK_DEPTH }, (_, at) => `d${at}`).join('/')}/X.md`;
    const api = apiFixture({ files: { [deep]: 'x\n' } });

    const response = await api.send(post('/v1/archive', [deep]));

    expect(bodyOf(response)['moves']).toEqual([]);
    expect(bodyOf(response)['failed']).toEqual([
      { path: deep, reason: expect.stringContaining('folders deep') },
    ]);
    expect(api.files.has(deep)).toBe(true);
  });
});

describe('GET /v1/archive, searched hard (A20-06)', () => {
  it('binds a capped number of words, however many are sent', async () => {
    const asked: (readonly unknown[])[] = [];
    const api = apiFixture({
      index: {
        query: async (_sql, parameters = []) => {
          asked.push(parameters);
          return {
            columns: ['path', 'title', 'archived', 'archivedFrom'],
            rows: [],
            truncated: false,
          };
        },
      },
    });
    const search = Array.from({ length: 5000 }, (_, at) => `w${at}`).join(' ');

    await api.send({ method: 'GET', path: '/v1/archive', query: { search } });

    expect(asked[0]?.length).toBeLessThan(200);
  });

  it('answers an index that cannot run the search as query_failed', async () => {
    const api = apiFixture({
      index: {
        query: async () => {
          throw new Error('SQLITE_ERROR at /Users/j/Vault/.atlas-cache/index.db');
        },
      },
    });

    const response = await api.send({ method: 'GET', path: '/v1/archive', query: { search: 'x' } });

    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(response.body)).not.toContain('/Users/j');
  });
});

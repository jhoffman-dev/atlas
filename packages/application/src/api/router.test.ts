/**
 * The router as a whole: which requests reach a handler, what answers without
 * a vault, and what a fault of ours looks like from outside.
 */

import { describe, expect, it } from 'vitest';
import { API_ERROR_STATUS, API_ROUTES } from './contract.ts';
import type { OpenNotes } from './ports.ts';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT } from '../testing/api-fixture.ts';
import { fakeOpenNotes } from '../testing/fake-ports.ts';

describe('routing', () => {
  it('echoes the request id on success and on failure', async () => {
    const api = apiFixture();
    const found = await api.send({ id: 'abc', method: 'GET', path: '/v1/status' });
    const missing = await api.send({ id: 'def', method: 'GET', path: '/v1/nope' });

    expect([found.id, missing.id]).toEqual(['abc', 'def']);
  });

  it('answers an unknown path with not_found_route', async () => {
    const response = await apiFixture().send({ method: 'GET', path: '/v1/nope' });

    expect(codeOf(response)).toBe('not_found_route');
    expect(response.status).toBe(404);
  });

  it('answers a known path asked with the wrong method with not_found_route', async () => {
    const response = await apiFixture().send({ method: 'DELETE', path: '/v1/notes' });
    expect(codeOf(response)).toBe('not_found_route');
  });

  it('takes a note path only as one encoded segment, never as raw slashes', async () => {
    const api = apiFixture({ files: { 'Tasks/Call.md': '# Call\n' } });

    const raw = await api.send({ method: 'GET', path: '/v1/notes/Tasks/Call.md' });
    const one = await api.send({ method: 'GET', path: `/v1/notes/${encoded('Tasks/Call.md')}` });

    expect(codeOf(raw)).toBe('not_found_route');
    expect(one.status).toBe(200);
  });

  it('does not match a route with an empty path segment', async () => {
    const response = await apiFixture().send({ method: 'GET', path: '/v1/notes//backlinks' });
    expect(codeOf(response)).toBe('not_found_route');
  });

  it('reaches a handler for every route in the contract', async () => {
    const api = apiFixture();
    for (const route of API_ROUTES) {
      const path = route.path.replace('{path}', 'Note.md');
      const response = await api.send({ method: route.method, path });
      expect(codeOf(response), `${route.method} ${route.path}`).not.toBe('not_found_route');
    }
  });
});

describe('with no vault open', () => {
  it('answers every route but status with no_vault', async () => {
    const api = apiFixture();
    api.open = null;

    for (const route of API_ROUTES.filter((candidate) => candidate.path !== '/v1/status')) {
      const path = route.path.replace('{path}', 'Note.md');
      const response = await api.send({ method: route.method, path, body: {} });
      expect(codeOf(response), `${route.method} ${route.path}`).toBe('no_vault');
      expect(response.status).toBe(503);
    }
  });

  it('still answers status, saying no vault is open', async () => {
    const api = apiFixture();
    api.open = null;

    const response = await api.send({ method: 'GET', path: '/v1/status' });

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      app: 'atlas',
      version: '1.4.0',
      vault: null,
      index: { ready: false, notes: 0 },
    });
  });
});

describe('status', () => {
  it('names the open vault and counts the notes the index holds', async () => {
    const api = apiFixture({
      index: { stats: async () => ({ notes: 42, properties: 0, links: 0 }) },
    });

    const response = await api.send({ method: 'GET', path: '/v1/status' });

    expect(bodyOf(response)).toMatchObject({
      vault: { name: 'Vault' },
      index: { ready: true, notes: 42 },
    });
  });

  it('reports an index still building as not ready', async () => {
    const api = apiFixture({
      index: { stats: async () => ({ notes: 42, properties: 0, links: 0 }) },
    });
    api.indexReady = false;

    const response = await api.send({ method: 'GET', path: '/v1/status' });
    expect(bodyOf(response)['index']).toEqual({ ready: false, notes: 0 });
  });

  it('reports an index that cannot count as not ready, rather than failing', async () => {
    const api = apiFixture({
      index: {
        stats: async () => {
          throw new Error('no such table: files');
        },
      },
    });

    const response = await api.send({ method: 'GET', path: '/v1/status' });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['index']).toEqual({ ready: false, notes: 0 });
  });
});

describe('a fault of ours', () => {
  it('is internal, with a generic message and no stack', async () => {
    const api = apiFixture({
      index: {
        backlinks: async () => {
          throw new Error('SECRET at /Users/j/Vault/.atlas-cache/index.db line 12');
        },
      },
      files: { 'Note.md': '# Note\n' },
    });

    const response = await api.send({ method: 'GET', path: '/v1/notes/Note.md/backlinks' });
    const text = JSON.stringify(response.body);

    expect(response.status).toBe(API_ERROR_STATUS.internal);
    expect(codeOf(response)).toBe('internal');
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('/Users/j');
    expect(text).not.toContain('    at ');
  });

  it('is internal when something throws a value that is not even an Error', async () => {
    const api = apiFixture({
      index: {
        backlinks: async () => {
          throw 'a string';
        },
      },
      files: { 'Note.md': '# Note\n' },
    });

    const response = await api.send({ method: 'GET', path: '/v1/notes/Note.md/backlinks' });
    expect(codeOf(response)).toBe('internal');
  });
});

describe('a vault switched while a request is running', () => {
  it('refuses the write with no_vault, and nothing lands in either vault', async () => {
    const api = apiFixture({ files: { 'Note.md': '# Note\n' } });
    const reading = api.deps.fs.readTextFile;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: async (path) => {
          const read = await reading(path);
          api.open = OTHER_VAULT;
          return read;
        },
      },
    };

    const response = await api.send({
      method: 'POST',
      path: '/v1/notes/Note.md/append',
      body: { markdown: 'late' },
    });

    expect(codeOf(response)).toBe('no_vault');
    expect(api.writes).toEqual([]);
  });

  it('does not route a property write through the panes of the vault opened since', async () => {
    const api = apiFixture({ files: { 'Note.md': '---\nstatus: todo\n---\n' } });
    const reading = api.deps.fs.readTextFile;
    let reachedPane = false;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: async (path) => {
          const read = await reading(path);
          api.open = OTHER_VAULT;
          return read;
        },
      },
      openNotes: {
        ...api.deps.openNotes,
        setPropertiesIfOpen: async () => {
          reachedPane = true;
          return true;
        },
      },
    };

    const response = await api.send({
      method: 'PATCH',
      path: '/v1/notes/Note.md/properties',
      body: { set: { status: 'done' } },
    });

    expect(codeOf(response)).toBe('no_vault');
    expect(reachedPane).toBe(false);
  });

  it('answers a failure the switch caused as no_vault rather than internal', async () => {
    const api = apiFixture();
    const creating = api.deps.fs.createNote;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        createNote: async (args) => {
          api.open = OTHER_VAULT;
          return creating(args);
        },
      },
    };

    const response = await api.send({
      method: 'POST',
      path: '/v1/capture',
      body: { text: 'Call Sam' },
    });

    expect(codeOf(response)).toBe('no_vault');
    expect(api.files.has('Call Sam.md')).toBe(false);
  });
});

/**
 * APFS finds `tasks/call sam.md` when the vault holds `Tasks/Call Sam.md`, and
 * an NFD spelling when it holds NFC. The panes hold the vault's own spelling,
 * so a request is resolved to it before anything asks whether a pane has it
 * (R15-01).
 */
describe('a note path spelled differently from the vault', () => {
  const HELD = 'Tasks/Call Sam.md';
  const ASKED = encoded('tasks/call sam.md');

  function apfs(openNotes: Partial<OpenNotes>) {
    const api = apiFixture({ files: { [HELD]: '# Call Sam\n' }, caseInsensitive: true });
    api.deps = { ...api.deps, openNotes: fakeOpenNotes(openNotes) };
    return api;
  }

  it('refuses a body write with unsaved_in_app when a pane holds the note unsaved', async () => {
    const api = apfs({ state: (path) => (path === HELD ? 'dirty' : 'closed') });

    const response = await api.send({
      method: 'POST',
      path: `/v1/notes/${ASKED}/append`,
      body: { markdown: 'x' },
    });

    expect(codeOf(response)).toBe('unsaved_in_app');
    expect(api.writes).toEqual([]);
  });

  it('writes properties through the pane that holds the note', async () => {
    const taken: string[] = [];
    const api = apfs({
      setPropertiesIfOpen: async ({ path }) => {
        taken.push(path);
        return path === HELD;
      },
    });

    const response = await api.send({
      method: 'PATCH',
      path: `/v1/notes/${ASKED}/properties`,
      body: { set: { status: 'done' } },
    });

    expect(response.status).toBe(200);
    expect(taken).toEqual([HELD]);
    expect(api.writes).toEqual([]);
  });

  it('answers with the path as the vault spells it', async () => {
    const response = await apfs({}).send({ method: 'GET', path: `/v1/notes/${ASKED}` });
    expect(bodyOf(response)['note']).toMatchObject({ path: HELD });
  });

  it('resolves the spelling without listing every note in the vault', async () => {
    const api = apfs({});
    let listed = 0;
    const listing = api.deps.fs.listNotes;
    api.deps = {
      ...api.deps,
      fs: { ...api.deps.fs, listNotes: async (options) => ((listed += 1), listing(options)) },
    };

    const response = await api.send({ method: 'GET', path: `/v1/notes/${ASKED}` });

    expect(bodyOf(response)['note']).toMatchObject({ path: HELD });
    expect(listed).toBe(0);
  });

  it('resolves a decomposed (NFD) spelling to the composed one the vault holds', async () => {
    const api = apiFixture({ files: { 'Café.md': '# Café\n' }, caseInsensitive: true });
    const decomposed = encoded('Café.md'.normalize('NFD'));

    const response = await api.send({ method: 'GET', path: `/v1/notes/${decomposed}` });

    expect(bodyOf(response)['note']).toMatchObject({ path: 'Café.md' });
  });
});

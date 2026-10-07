/**
 * Writes to a note that already exists. These are the routes that can lose
 * someone's work, so each guard is tried both ways: the write that must be
 * refused writes nothing, and the one that is allowed lands exactly once.
 */

import { describe, expect, it } from 'vitest';
import type { VaultPath } from '@atlas/domain';
import type { OpenNotes } from './ports.ts';
import type { PropertyChanges } from '../query/set-property.ts';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import { fakeOpenNotes } from '../testing/fake-ports.ts';
import { NoteStillOpeningError } from '../notes/note-still-opening-error.ts';

const NOTE = '---\nstatus: todo\ndue: 2026-10-01\n---\n\n# Call Sam\n\nAbout the lease.\n';

function vault(openNotes: Partial<OpenNotes> = {}) {
  const api = apiFixture({ files: { 'Call.md': NOTE } });
  api.deps = { ...api.deps, openNotes: fakeOpenNotes(openNotes) };
  return api;
}

const modifiedOf = (api: ReturnType<typeof vault>) => api.files.get('Call.md')?.modified ?? -1;

/** Moves the note on underneath, as another program saving it would. */
function changeUnderneath(api: ReturnType<typeof vault>, { afterReads }: { afterReads: number }) {
  const reading = api.deps.fs.readTextFile;
  let reads = 0;
  api.deps = {
    ...api.deps,
    fs: {
      ...api.deps.fs,
      readTextFile: async (path) => {
        const read = await reading(path);
        reads += 1;
        if (reads === afterReads)
          api.files.set('Call.md', { text: `${NOTE}edited\n`, modified: 999 });
        return read;
      },
    },
  };
}

describe('PATCH /v1/notes/{path}/properties', () => {
  const patch = (api: ReturnType<typeof vault>, body: unknown) =>
    api.send({ method: 'PATCH', path: '/v1/notes/Call.md/properties', body });

  it('sets properties, removes the ones set to null, and answers with the note', async () => {
    const api = vault();

    const response = await patch(api, { set: { status: 'done', due: null } });

    expect(response.status).toBe(200);
    expect(api.files.get('Call.md')?.text).toBe(
      '---\nstatus: done\n---\n\n# Call Sam\n\nAbout the lease.\n',
    );
    expect(bodyOf(response)['note']).toMatchObject({
      properties: { status: 'done' },
      modified: modifiedOf(api),
    });
  });

  it('writes when ifModified is the time the note has', async () => {
    const api = vault();
    const response = await patch(api, { set: { status: 'done' }, ifModified: modifiedOf(api) });
    expect(response.status).toBe(200);
  });

  it('is a conflict, writing nothing, when ifModified is another time', async () => {
    const api = vault();

    const response = await patch(api, { set: { status: 'done' }, ifModified: modifiedOf(api) - 1 });

    expect(codeOf(response)).toBe('conflict');
    expect(response.status).toBe(409);
    expect(api.writes).toEqual([]);
  });

  it('is a conflict when the note changes between the check and the write', async () => {
    const api = vault();
    changeUnderneath(api, { afterReads: 1 });

    const response = await patch(api, { set: { status: 'done' } });

    expect(codeOf(response)).toBe('conflict');
    expect(api.writes).toEqual([]);
  });

  it('is a conflict when the host refuses the write because the note moved on', async () => {
    const api = vault();
    changeUnderneath(api, { afterReads: 2 });

    const response = await patch(api, { set: { status: 'done' } });

    expect(codeOf(response)).toBe('conflict');
    expect(api.writes).toEqual([]);
  });

  it('goes through the pane holding the note, never under it', async () => {
    const taken: { path: VaultPath; values: PropertyChanges }[] = [];
    const api = vault({
      setPropertiesIfOpen: async (args) => {
        taken.push(args);
        return true;
      },
    });

    const response = await patch(api, { set: { status: 'done' } });

    expect(response.status).toBe(200);
    expect(taken).toEqual([{ path: 'Call.md', values: { status: 'done' } }]);
    expect(api.writes).toEqual([]);
  });

  it('is a conflict that says to retry when the pane holding the note is still opening it', async () => {
    const api = vault({
      setPropertiesIfOpen: async ({ path }) => {
        throw new NoteStillOpeningError(path);
      },
    });

    const response = await patch(api, { set: { status: 'done' } });

    expect(codeOf(response)).toBe('conflict');
    expect(response.status).toBe(409);
    expect(bodyOf(response)['error']).toMatchObject({ message: expect.stringMatching(/retry/i) });
    expect(api.writes).toEqual([]);
  });

  it('is internal when the pane fails for a reason that is not a change underneath', async () => {
    const api = vault({
      setPropertiesIfOpen: async () => {
        throw new Error('editor exploded');
      },
    });

    const response = await patch(api, { set: { status: 'done' } });
    expect(codeOf(response)).toBe('internal');
  });

  it('is not_found for a note that does not exist', async () => {
    const api = vault();
    const response = await api.send({
      method: 'PATCH',
      path: '/v1/notes/Missing.md/properties',
      body: { set: { status: 'done' } },
    });
    expect(codeOf(response)).toBe('not_found');
  });

  it.each([
    ['a null body', null, 'body'],
    ['an array body', [{ set: {} }], 'body'],
    ['a string body', 'status=done', 'body'],
    ['no set', {}, 'set'],
    ['set as an array', { set: ['status'] }, 'set'],
    ['set with nothing in it', { set: {} }, 'set'],
    ['set with an empty key', { set: { ' ': 1 } }, 'set'],
    ['ifModified as a string', { set: { a: 1 }, ifModified: '12' }, 'ifModified'],
    ['ifModified negative', { set: { a: 1 }, ifModified: -1 }, 'ifModified'],
    ['ifModified with a fraction', { set: { a: 1 }, ifModified: 1.5 }, 'ifModified'],
  ])('refuses %s as invalid, naming the field', async (_, body, field) => {
    const api = vault();

    const response = await patch(api, body);

    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain(field);
    expect(api.writes).toEqual([]);
  });
});

describe('POST /v1/notes/{path}/append', () => {
  const append = (api: ReturnType<typeof vault>, body: unknown) =>
    api.send({ method: 'POST', path: '/v1/notes/Call.md/append', body });

  it('adds the markdown after the body, frontmatter untouched', async () => {
    const api = vault();

    const response = await append(api, { markdown: '- [ ] ring back' });

    expect(api.files.get('Call.md')?.text).toBe(`${NOTE}\n- [ ] ring back\n`);
    expect(bodyOf(response)['note']).toMatchObject({ modified: modifiedOf(api) });
  });

  it('is a conflict when ifModified is given and wrong', async () => {
    const api = vault();
    const response = await append(api, { markdown: 'x', ifModified: 1 });
    expect(codeOf(response)).toBe('conflict');
    expect(api.writes).toEqual([]);
  });

  it('is refused with unsaved_in_app when a pane holds unsaved edits', async () => {
    const api = vault({ state: () => 'dirty' });

    const response = await append(api, { markdown: 'x' });

    expect(codeOf(response)).toBe('unsaved_in_app');
    expect(response.status).toBe(409);
    expect(api.writes).toEqual([]);
  });

  it('reloads a clean pane holding the note, once the write has landed', async () => {
    const events: string[] = [];
    const api = vault({ state: () => 'clean', reload: (path) => events.push(`reload ${path}`) });
    const writing = api.deps.fs.writeTextFile;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        writeTextFile: async (args) => {
          events.push(`write ${args.path}`);
          return writing(args);
        },
      },
    };

    await append(api, { markdown: 'x' });

    expect(events).toEqual(['write Call.md', 'reload Call.md']);
  });

  it('reloads nothing when no pane holds the note', async () => {
    const reloaded: string[] = [];
    const api = vault({ reload: (path) => reloaded.push(path) });
    await append(api, { markdown: 'x' });
    expect(reloaded).toEqual([]);
  });

  it.each([
    ['no markdown', {}],
    ['markdown that is not a string', { markdown: 12 }],
  ])('refuses %s as invalid', async (_, body) => {
    const response = await append(vault(), body);
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain('markdown');
  });
});

describe('PUT /v1/notes/{path}/body', () => {
  const replace = (api: ReturnType<typeof vault>, body: unknown) =>
    api.send({ method: 'PUT', path: '/v1/notes/Call.md/body', body });

  it('replaces the body and keeps the frontmatter byte for byte', async () => {
    const api = vault();

    const response = await replace(api, { markdown: '# New\n', ifModified: modifiedOf(api) });

    expect(response.status).toBe(200);
    expect(api.files.get('Call.md')?.text).toBe('---\nstatus: todo\ndue: 2026-10-01\n---\n# New\n');
    expect(bodyOf(response)['note']).toMatchObject({ body: '# New\n', modified: modifiedOf(api) });
  });

  it('refuses a replace without ifModified as invalid: there is no blind overwrite', async () => {
    const api = vault();

    const response = await replace(api, { markdown: '# New\n' });

    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain('ifModified');
    expect(api.writes).toEqual([]);
  });

  it('is a conflict when ifModified is another time', async () => {
    const api = vault();
    const response = await replace(api, { markdown: '# New\n', ifModified: modifiedOf(api) + 1 });
    expect(codeOf(response)).toBe('conflict');
    expect(api.writes).toEqual([]);
  });

  it('is a conflict when the note changes between the check and the write', async () => {
    const api = vault();
    changeUnderneath(api, { afterReads: 1 });

    const response = await replace(api, { markdown: '# New\n', ifModified: modifiedOf(api) });

    expect(codeOf(response)).toBe('conflict');
    expect(api.files.get('Call.md')?.text).toBe(`${NOTE}edited\n`);
  });

  it('is refused with unsaved_in_app when a pane holds unsaved edits', async () => {
    const api = vault({ state: () => 'dirty' });
    const response = await replace(api, { markdown: '# New\n', ifModified: modifiedOf(api) });
    expect(codeOf(response)).toBe('unsaved_in_app');
    expect(api.writes).toEqual([]);
  });

  it('writes under a clean pane, then reloads it', async () => {
    const reloaded: string[] = [];
    const api = vault({ state: () => 'clean', reload: (path) => reloaded.push(path) });

    const response = await replace(api, { markdown: '# New\n', ifModified: modifiedOf(api) });

    expect(response.status).toBe(200);
    expect(reloaded).toEqual(['Call.md']);
  });

  it('is not_found for a note that does not exist', async () => {
    const api = vault();
    const response = await api.send({
      method: 'PUT',
      path: '/v1/notes/Missing.md/body',
      body: { markdown: 'x', ifModified: 1 },
    });
    expect(codeOf(response)).toBe('not_found');
  });

  it('is internal when the write fails for a reason that is not a change underneath', async () => {
    const api = vault();
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        writeTextFile: async () => {
          throw new Error('disk full');
        },
      },
    };

    const response = await replace(api, { markdown: '# New\n', ifModified: modifiedOf(api) });
    expect(codeOf(response)).toBe('internal');
  });
});

/**
 * Issue #16 through the local API: the templates, read-only (ADR-0026). Each
 * is listed with what makes notes from it, as the Templates page says, and
 * one is read by the name `POST /v1/notes { template }` takes. A template is
 * never one of the vault's notes, so no note route hands one out (tags.test.ts
 * holds the same for the tag counts).
 */

import { describe, expect, it } from 'vitest';
import { VaultAccessError } from '../vault/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const PERSON = jsonNote({ name: 'person', label: 'Person', properties: { role: 'text' } });
const BOOK = jsonNote({ name: 'book', label: 'Reading list', properties: {} });
const TASK_TYPE = jsonNote({ name: 'task', label: 'Task', properties: {} });

const PERSON_TEMPLATE = '---\ntype: person\nrole:\n---\n\n## Met\n';

function vault(files: Record<string, string> = {}) {
  return apiFixture({
    markdown: jsonMarkdown(),
    files: {
      '.atlas/types/person.md': PERSON,
      '.atlas/types/book.md': BOOK,
      '.atlas/types/task.md': TASK_TYPE,
      '.atlas/templates/People/Person.md': PERSON_TEMPLATE,
      '.atlas/templates/Daily.markdown': '---\ntype: daily\n---\n\n## Today\n',
      '.atlas/templates/task.md': '---\ntype: task\n---\n',
      '.atlas/templates/Meeting.md': '# Agenda\n',
      ...files,
    },
  });
}

const list = (api: ReturnType<typeof vault>) => api.send({ method: 'GET', path: '/v1/templates' });
const read = (api: ReturnType<typeof vault>, name: string) =>
  api.send({ method: 'GET', path: `/v1/templates/${encoded(name)}` });

describe('GET /v1/templates', () => {
  it('lists every template under the folder, subfolders and .markdown too, with what uses each', async () => {
    const response = await list(vault());

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      templates: [
        { name: 'Daily', path: '.atlas/templates/Daily.markdown', uses: [{ kind: 'daily' }] },
        { name: 'Meeting', path: '.atlas/templates/Meeting.md', uses: [] },
        {
          name: 'Person',
          path: '.atlas/templates/People/Person.md',
          uses: [{ kind: 'type', type: 'person', label: 'Person' }],
        },
        {
          name: 'task',
          path: '.atlas/templates/task.md',
          uses: [{ kind: 'type', type: 'task', label: 'Task' }, { kind: 'capture' }],
        },
      ],
      typesWithoutTemplate: ['book'],
    });
  });

  it('answers none, and every type without one, for a vault with no templates folder', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: { '.atlas/types/person.md': PERSON },
    });

    expect(bodyOf(await list(api))).toEqual({ templates: [], typesWithoutTemplate: ['person'] });
  });

  it('writes nothing', async () => {
    const api = vault();
    await list(api);
    await read(api, 'Person');
    expect(api.writes).toEqual([]);
  });

  it('answers no_vault when the vault is switched while the templates are read', async () => {
    const api = vault();
    const listing = api.deps.fs.listDirectory;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        listDirectory: async (...args) => {
          api.open = OTHER_VAULT;
          return listing(...args);
        },
      },
    };

    expect(codeOf(await list(api))).toBe('no_vault');
  });
});

describe('GET /v1/templates/{name}', () => {
  it('answers a template by name, in any case: its properties and its body byte for byte', async () => {
    const response = await read(vault(), 'person');

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      template: {
        name: 'Person',
        path: '.atlas/templates/People/Person.md',
        uses: [{ kind: 'type', type: 'person', label: 'Person' }],
        properties: { type: 'person', role: '' },
        body: '\n## Met\n',
      },
    });
  });

  it('answers a template with no frontmatter as no properties and its whole text', async () => {
    const response = await read(vault(), 'Meeting');
    expect(bodyOf(response)['template']).toMatchObject({ properties: {}, body: '# Agenda\n' });
  });

  it('answers the one POST /v1/notes would use: of two with one name, the one nearer the top', async () => {
    const api = vault({ '.atlas/templates/Old/Meeting.md': '# Old agenda\n' });

    const response = await read(api, 'Meeting');

    expect(bodyOf(response)['template']).toMatchObject({
      path: '.atlas/templates/Meeting.md',
      body: '# Agenda\n',
    });
  });

  it('finds a name however it is normalized, as the Mac disk does', async () => {
    const api = vault({ [`.atlas/templates/${'Café'.normalize('NFC')}.md`]: '# Menu\n' });
    const response = await read(api, 'Café'.normalize('NFD'));
    expect(bodyOf(response)['template']).toMatchObject({
      name: 'Café'.normalize('NFC'),
      body: '# Menu\n',
    });
  });

  it('is not_found for a name no template has', async () => {
    const response = await read(vault(), 'Recipe');
    expect(codeOf(response)).toBe('not_found');
  });

  it('is not_found for a template gone between listing and reading', async () => {
    const api = vault();
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: async () => {
          throw new VaultAccessError('no such entry');
        },
      },
    };

    expect(codeOf(await read(api, 'Person'))).toBe('not_found');
  });

  it('passes on a failure that is not a missing file, rather than calling it not_found', async () => {
    const api = vault();
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: async () => {
          throw new Error('disk on fire');
        },
      },
    };

    expect(codeOf(await read(api, 'Person'))).toBe('internal');
  });

  it('answers no_vault when the vault is switched while the template is read', async () => {
    const api = vault();
    const reading = api.deps.fs.readTextFile;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: async (path) => {
          const text = await reading(path);
          if (path.startsWith('.atlas/templates/')) api.open = OTHER_VAULT;
          return text;
        },
      },
    };

    expect(codeOf(await read(api, 'Person'))).toBe('no_vault');
  });

  it('is invalid for a name that is not validly percent-encoded', async () => {
    const response = await vault().send({ method: 'GET', path: '/v1/templates/%E0%A4%A' });
    expect(codeOf(response)).toBe('invalid');
  });
});

describe('no note route hands out a template (ADR-0026)', () => {
  const TEMPLATE_PATHS = [
    '.atlas/templates/People/Person.md',
    '.atlas/Templates/Company.md',
    '.atlas/templates/Daily.markdown',
  ];

  it('leaves templates out of the notes list, even under a folder cased otherwise', async () => {
    const api = vault({ '.atlas/Templates/Company.md': '# Co\n', 'Ann.md': '# Ann\n' });

    const response = await api.send({ method: 'GET', path: '/v1/notes' });

    const paths = (bodyOf(response)['notes'] as { path: string }[]).map((note) => note.path);
    expect(paths).toEqual(['Ann.md']);
  });

  it('leaves templates out of search hits and backlinks the index still holds', async () => {
    const api = apiFixture({
      files: { 'Ann.md': '# Ann\n', '.atlas/templates/People/Person.md': PERSON_TEMPLATE },
      index: {
        search: async () =>
          ['Ann.md', ...TEMPLATE_PATHS].map((path) => ({ path, title: 'x', snippet: 'x' })),
        backlinks: async () => ['Ann.md', ...TEMPLATE_PATHS],
      },
    });

    const hits = bodyOf(await api.send({ method: 'GET', path: '/v1/search', query: { q: 'x' } }));
    const links = bodyOf(
      await api.send({ method: 'GET', path: `/v1/notes/${encoded('Ann.md')}/backlinks` }),
    );

    expect((hits['hits'] as { path: string }[]).map((hit) => hit.path)).toEqual(['Ann.md']);
    expect((links['backlinks'] as { path: string }[]).map((note) => note.path)).toEqual(['Ann.md']);
  });

  it('refuses a template path where a note path is asked for', async () => {
    const response = await vault().send({
      method: 'GET',
      path: `/v1/notes/${encoded('.atlas/templates/Meeting.md')}`,
    });
    expect(codeOf(response)).toBe('invalid');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { VaultPath } from '@atlas/domain';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT } from '../testing/api-fixture.ts';
import { fakeMarkdown, fakeOpenNotes } from '../testing/fake-ports.ts';
import { tagIndexQuery } from '../testing/tag-index.ts';
import type { OpenNotes } from './ports.ts';

/* Phase 20's tags through the local API: the tree, the notes using a tag, and renaming one. */

const FILES = {
  'Notes/a.md': 'An #idea, and #Idea again, and #ideas.\n',
  'Notes/b.md': '---\ntags: idea, other\n---\nBody with #idea/sub.\n',
  'c.md': 'Nothing but `#idea` in code.\n',
  'd.md': 'Only #thought here, and #para/resource.\n',
  '.atlas/templates/Idea.md': '---\ntags: idea\n---\n',
};

type Api = ReturnType<typeof apiFixture>;

function vault(files: Record<string, string> = FILES, openNotes: Partial<OpenNotes> = {}): Api {
  const markdown = fakeMarkdown();
  const api = apiFixture({ files, markdown, index: { query: tagIndexQuery({ files, markdown }) } });
  api.deps = { ...api.deps, openNotes: fakeOpenNotes(openNotes) };
  return api;
}

const textOf = (api: Api, path: string) => api.files.get(path)?.text;

const tags = (api: Api, query: Record<string, string> = {}) =>
  api.send({ method: 'GET', path: '/v1/tags', query });

const notesOf = (api: Api, tag: string, query: Record<string, string> = {}) =>
  api.send({ method: 'GET', path: `/v1/tags/${encoded(tag)}/notes`, query });

const rename = (api: Api, tag: string, body: unknown) =>
  api.send({ method: 'POST', path: `/v1/tags/${encoded(tag)}/rename`, body });

describe('GET /v1/tags', () => {
  it('answers every tag nested under its parent, with its own uses and its total', async () => {
    const body = bodyOf(await tags(vault()));
    expect(body['tags']).toEqual([
      {
        name: 'idea',
        label: 'idea',
        count: 3,
        total: 4,
        children: [{ name: 'idea/sub', label: 'sub', count: 1, total: 1, children: [] }],
      },
      { name: 'ideas', label: 'ideas', count: 1, total: 1, children: [] },
      { name: 'other', label: 'other', count: 1, total: 1, children: [] },
      {
        name: 'para',
        label: 'para',
        count: 0,
        total: 1,
        children: [{ name: 'para/resource', label: 'resource', count: 1, total: 1, children: [] }],
      },
      { name: 'thought', label: 'thought', count: 1, total: 1, children: [] },
    ]);
  });

  it('counts only notes the API reads, leaving out a tag only .atlas templates use', async () => {
    const api = vault({
      'a.md': 'Uses #idea.\n',
      '.atlas/templates/Plan.md': '#plan and #idea\n',
      'Notes/.hidden/x.md': '#secret\n',
    });
    expect(bodyOf(await tags(api))['tags']).toEqual([
      { name: 'idea', label: 'idea', count: 1, total: 1, children: [] },
    ]);
  });

  it('leaves out archived notes, as the tags page does', async () => {
    const api = vault({
      'a.md': 'Uses #idea.\n',
      'Archive/b.md': 'Filed #idea and #old.\n',
    });
    expect(bodyOf(await tags(api))['tags']).toEqual([
      { name: 'idea', label: 'idea', count: 1, total: 1, children: [] },
    ]);
    expect(codeOf(await notesOf(api, 'old'))).toBe('not_found');
  });

  it('shows a tag as the first note the API reads spells it', async () => {
    const api = vault({ '.atlas/templates/A.md': '#IDEA\n', 'b.md': '#Idea\n' });
    expect(bodyOf(await tags(api))['tags']).toEqual([
      { name: 'Idea', label: 'Idea', count: 1, total: 1, children: [] },
    ]);
  });

  it('sorts by how often a tag is used when asked to', async () => {
    const api = vault({ 'a.md': '#zebra #zebra #apple\n' });
    const names = (body: Record<string, unknown>) =>
      (body['tags'] as { name: string }[]).map((tag) => tag.name);

    expect(names(bodyOf(await tags(api, { sort: 'frequency' })))).toEqual(['zebra', 'apple']);
    expect(names(bodyOf(await tags(api, { sort: 'name' })))).toEqual(['apple', 'zebra']);
  });

  it('refuses a sort it does not know', async () => {
    expect(codeOf(await tags(vault(), { sort: 'size' }))).toBe('invalid');
  });

  it('answers no_vault when the vault is switched while the index is read', async () => {
    const api = vault();
    const query = api.deps.index.query;
    api.deps = {
      ...api.deps,
      index: {
        ...api.deps.index,
        query: async (sql, parameters) => {
          api.open = OTHER_VAULT;
          return query(sql, parameters);
        },
      },
    };
    expect(codeOf(await tags(api))).toBe('no_vault');
  });
});

describe('GET /v1/tags/{tag}/notes', () => {
  it('lists the notes using the tag or one nested under it, in path order, leaving out .atlas', async () => {
    const response = await notesOf(vault(), 'idea');

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      tag: expect.objectContaining({ name: 'idea', count: 3, total: 4 }),
      notes: [
        { path: 'Notes/a.md', title: 'a', uses: 2 },
        { path: 'Notes/b.md', title: 'b', uses: 2 },
      ],
      next: null,
    });
  });

  it('leaves out archived notes', async () => {
    const api = vault({ 'a.md': 'Uses #idea.\n', 'Archive/b.md': 'Filed #idea.\n' });
    expect(bodyOf(await notesOf(api, 'idea'))['notes']).toEqual([
      { path: 'a.md', title: 'a', uses: 1 },
    ]);
  });

  it('finds the tag however it is cased, with or without its #, and answers as the vault spells it', async () => {
    const api = vault();
    for (const asked of ['IDEA', '#Idea', '#idea#']) {
      const body = bodyOf(await notesOf(api, asked));
      expect((body['tag'] as { name: string }).name, asked).toBe('idea');
      expect(body['notes'], asked).toHaveLength(2);
    }
  });

  it('finds a nested tag, and a parent only ever written with a child', async () => {
    const api = vault();
    expect(bodyOf(await notesOf(api, 'idea/sub'))['notes']).toEqual([
      { path: 'Notes/b.md', title: 'b', uses: 1 },
    ]);
    expect(bodyOf(await notesOf(api, 'para'))['notes']).toEqual([
      { path: 'd.md', title: 'd', uses: 1 },
    ]);
  });

  it('pages with limit and cursor', async () => {
    const api = vault();
    const first = bodyOf(await notesOf(api, 'idea', { limit: '1' }));
    expect(first['notes']).toEqual([{ path: 'Notes/a.md', title: 'a', uses: 2 }]);
    expect(first['next']).toEqual(expect.any(String));

    const second = bodyOf(
      await notesOf(api, 'idea', { limit: '1', cursor: String(first['next']) }),
    );
    expect(second['notes']).toEqual([{ path: 'Notes/b.md', title: 'b', uses: 2 }]);
    expect(second['next']).toBeNull();
  });

  it('refuses a cursor it did not hand out, and a limit out of range', async () => {
    const api = vault();
    expect(codeOf(await notesOf(api, 'idea', { cursor: '%%%' }))).toBe('invalid');
    expect(codeOf(await notesOf(api, 'idea', { limit: '0' }))).toBe('invalid');
  });

  it('answers not_found for a tag no note uses', async () => {
    expect(codeOf(await notesOf(vault(), 'nothing'))).toBe('not_found');
  });

  it('answers not_found for a tag only .atlas templates use, for listing and renaming alike', async () => {
    const api = vault({ 'a.md': 'Uses #idea.\n', '.atlas/templates/Plan.md': '#plan\n' });
    expect(codeOf(await notesOf(api, 'plan'))).toBe('not_found');
    expect(codeOf(await rename(api, 'plan', { to: 'x', dryRun: true }))).toBe('not_found');
  });

  it('refuses a cursor that decodes to something no page could end on', async () => {
    const api = vault();
    for (const path of ['no-extension', '../a.md', '.atlas/templates/Idea.md', '']) {
      expect(codeOf(await notesOf(api, 'idea', { cursor: btoa(path) })), path).toBe('invalid');
    }
  });

  it.each([
    ['a name with no letter', '42'],
    ['an _ opening it', '_draft'],
    ['an _ closing it', 'draft_'],
    ['both', '_draft_'],
    ['an empty part', 'idea//sub'],
    ['a stray character', 'idea!'],
  ])('refuses %s as invalid', async (_, tag) => {
    expect(codeOf(await notesOf(vault(), tag))).toBe('invalid');
  });

  it('refuses a tag segment that is not validly percent-encoded', async () => {
    const response = await vault().send({ method: 'GET', path: '/v1/tags/%E0%A4/notes' });
    expect(codeOf(response)).toBe('invalid');
  });

  it('takes a nested tag only as one encoded segment', async () => {
    const response = await vault().send({ method: 'GET', path: '/v1/tags/idea/sub/notes' });
    expect(codeOf(response)).toBe('not_found_route');
  });
});

describe('POST /v1/tags/{tag}/rename', () => {
  it('says a rename in the Activity log, and not a preview of one', async () => {
    const api = vault();
    await rename(api, 'idea', { to: 'concept', dryRun: true });
    expect(api.activity.reports).toEqual([]);
    await rename(api, 'idea', { to: 'concept' });
    expect(api.activity.reports).toEqual([
      { level: 'info', kind: 'api', message: 'POST v1/tags/{tag}/rename', subject: null },
    ]);
  });

  it('previews with dryRun: the notes, their uses, the notes skipped, and writes nothing', async () => {
    const api = vault();

    const response = await rename(api, 'IDEA', { to: '#concept', dryRun: true });

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      rename: {
        from: 'idea',
        to: 'concept',
        files: 2,
        uses: 4,
        mergesInto: null,
        notes: [
          { path: 'Notes/a.md', title: 'a', uses: 2 },
          { path: 'Notes/b.md', title: 'b', uses: 2 },
        ],
        skipped: [
          {
            path: '.atlas/templates/Idea.md',
            reason: 'in .atlas or a hidden folder, which the API cannot write',
          },
        ],
      },
    });
    expect(api.writes).toEqual([]);
  });

  it('renames in every user-space note, byte for byte apart from the tags, and reports it', async () => {
    const api = vault();

    const response = await rename(api, 'idea', { to: 'concept' });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['report']).toEqual({
      updated: ['Notes/a.md', 'Notes/b.md'],
      failed: [],
    });
    expect(textOf(api, 'Notes/a.md')).toBe('An #concept, and #concept again, and #ideas.\n');
    expect(textOf(api, 'Notes/b.md')).toBe(
      '---\ntags: concept, other\n---\nBody with #concept/sub.\n',
    );
    expect(textOf(api, 'c.md')).toBe(FILES['c.md']);
    expect(textOf(api, '.atlas/templates/Idea.md')).toBe(FILES['.atlas/templates/Idea.md']);
    expect(api.writes.map((write) => write.path)).toEqual(['Notes/a.md', 'Notes/b.md']);
  });

  it('refuses a merge into a tag in use unless merge is true, writing nothing', async () => {
    const api = vault();

    const refused = await rename(api, 'idea', { to: 'Thought' });
    expect(codeOf(refused)).toBe('exists');
    expect(api.writes).toEqual([]);

    const preview = bodyOf(await rename(api, 'idea', { to: 'Thought', dryRun: true }));
    expect((preview['rename'] as { mergesInto: string }).mergesInto).toBe('thought');

    const merged = await rename(api, 'idea', { to: 'Thought', merge: true });
    expect(merged.status).toBe(200);
    expect(textOf(api, 'Notes/a.md')).toBe('An #Thought, and #Thought again, and #ideas.\n');
  });

  it('is no merge when only the case changes', async () => {
    const api = vault();
    const response = await rename(api, 'idea', { to: 'Idea' });
    expect(response.status).toBe(200);
    expect(textOf(api, 'Notes/b.md')).toBe('---\ntags: Idea, other\n---\nBody with #Idea/sub.\n');
  });

  it('leaves a note being typed in alone, never saving the typing, and reports it', async () => {
    const reload = vi.fn();
    const api = vault(FILES, {
      state: (path: VaultPath) =>
        path === 'Notes/a.md' ? 'dirty' : path === 'Notes/b.md' ? 'clean' : 'closed',
      reload,
    });

    const response = await rename(api, 'idea', { to: 'concept' });

    expect(bodyOf(response)['report']).toEqual({
      updated: ['Notes/b.md'],
      failed: [{ path: 'Notes/a.md', reason: 'The note has unsaved changes.' }],
    });
    expect(textOf(api, 'Notes/a.md')).toBe(FILES['Notes/a.md']);
    expect(reload).toHaveBeenCalledWith('Notes/b.md');
    expect(reload).not.toHaveBeenCalledWith('Notes/a.md');
  });

  it('answers no_vault, writing no more, when the vault is switched mid-rename', async () => {
    let asked = 0;
    const api: Api = vault(FILES, {
      state: () => {
        asked += 1;
        // The switch lands once the first note is written, before the second is.
        if (asked > 2) api.open = OTHER_VAULT;
        return 'closed';
      },
    });

    const response = await rename(api, 'idea', { to: 'concept' });

    expect(codeOf(response)).toBe('no_vault');
    expect(api.writes.map((write) => write.path)).toEqual(['Notes/a.md']);
  });

  it.each([
    ['an empty name', { to: '' }, /Give the tag a name/],
    ['a name opening with _', { to: '_concept' }, /may not start or end with _/],
    ['a part closing with _', { to: 'concept/draft_' }, /may not start or end with _/],
    ['a name with no letter', { to: '2026' }, /with a letter in it/],
    ['a name nested under itself', { to: 'Idea/sub/deeper' }, /can’t be moved inside itself/],
  ])('refuses %s with the reason, writing nothing', async (_, body, reason) => {
    const api = vault();
    const response = await rename(api, 'idea', body);
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toMatch(reason);
    expect(api.writes).toEqual([]);
  });

  it.each([
    ['no body', null],
    ['to missing', {}],
    ['to not a string', { to: 3 }],
    ['dryRun not a boolean', { to: 'x', dryRun: 'yes' }],
    ['merge not a boolean', { to: 'x', merge: 1 }],
  ])('refuses %s as invalid', async (_, body) => {
    expect(codeOf(await rename(vault(), 'idea', body))).toBe('invalid');
  });

  it('answers not_found for a tag no note uses, and invalid for a name no tag can have', async () => {
    expect(codeOf(await rename(vault(), 'nothing', { to: 'x' }))).toBe('not_found');
    expect(codeOf(await rename(vault(), '_idea_', { to: 'x' }))).toBe('invalid');
  });

  it('renames in archived notes too, so one unarchived later does not keep the old name', async () => {
    const api = vault({ 'a.md': 'Uses #idea.\n', 'Archive/b.md': 'Filed #idea.\n' });

    const response = await rename(api, 'idea', { to: 'concept' });

    expect(bodyOf(response)['report']).toEqual({ updated: ['a.md', 'Archive/b.md'], failed: [] });
    expect(textOf(api, 'Archive/b.md')).toBe('Filed #concept.\n');
  });

  it('refuses a merge into a tag only an archived note uses unless merge is true', async () => {
    const api = vault({ 'a.md': 'Uses #idea.\n', 'Archive/b.md': 'Filed #concept.\n' });
    expect(codeOf(await rename(api, 'idea', { to: 'concept' }))).toBe('exists');
    expect(api.writes).toEqual([]);
  });

  it('renames a nested tag alone, leaving its parent', async () => {
    const api = vault();
    await rename(api, 'idea/sub', { to: 'idea/part' });
    expect(textOf(api, 'Notes/b.md')).toBe('---\ntags: idea, other\n---\nBody with #idea/part.\n');
    expect(textOf(api, 'Notes/a.md')).toBe(FILES['Notes/a.md']);
  });
});

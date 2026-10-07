import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

/* U-13 through the local API: the add button's types, and adding a note as it does. */

const TASK = jsonNote({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['todo', 'done'] },
    estimate: 'number',
    due: 'date',
    notes: 'text',
  },
});
const RECIPE = jsonNote({ name: 'recipe', label: 'Recipe', properties: { cuisine: 'text' } });

type Api = ReturnType<typeof apiFixture>;

const vault = (files: Record<string, string> = {}) =>
  apiFixture({
    markdown: jsonMarkdown(),
    files: { '.atlas/types/task.md': TASK, '.atlas/types/recipe.md': RECIPE, ...files },
  });

const add = (api: Api, body: unknown) => api.send({ method: 'POST', path: '/v1/quick-add', body });

describe('GET /v1/quick-add', () => {
  const list = async (api: Api) =>
    bodyOf(await api.send({ method: 'GET', path: '/v1/quick-add' }))['types'];

  it('offers Task, and the fields it asks for, when the settings say nothing', async () => {
    expect(await list(vault())).toEqual([
      { name: 'task', label: 'Task', fields: ['status', 'due'] },
    ]);
  });

  it('offers the types the settings list, in their order, skipping any the vault lacks', async () => {
    const api = vault({
      '.atlas/settings.md': jsonNote({ quickAdd: ['recipe', 'gone', 'task'] }),
    });
    expect(await list(api)).toEqual([
      { name: 'recipe', label: 'Recipe', fields: [] },
      { name: 'task', label: 'Task', fields: ['status', 'due'] },
    ]);
  });

  it('offers nothing when the person took every type away', async () => {
    expect(await list(vault({ '.atlas/settings.md': jsonNote({ quickAdd: [] }) }))).toEqual([]);
  });
});

describe('POST /v1/quick-add', () => {
  it('adds a note of the type with its fields as their kinds store them, answering 201', async () => {
    const api = vault();

    const response = await add(api, {
      type: 'task',
      name: 'Call Sam',
      values: { status: 'done', estimate: '3', notes: '' },
    });

    expect(response.status).toBe(201);
    const note = bodyOf(response)['note'] as { path: string; properties: object };
    expect(note.path).toMatch(/Call Sam\.md$/);
    expect(note.properties).toEqual({ type: 'task', status: 'done', estimate: '3' });
    expect(api.writes).toHaveLength(1);
  });

  it('starts from the type’s template, and numbers a name that is taken', async () => {
    const api = vault({
      '.atlas/templates/Recipe.md': '---\ntype: recipe\ncuisine: any\n---\n\n## Method\n',
      'Soup.md': '# Soup\n',
    });

    const response = await add(api, { type: 'recipe', name: 'Soup', values: { cuisine: 'Thai' } });

    const note = bodyOf(response)['note'] as { path: string; properties: object; body: string };
    expect(note.path).toBe('Soup 2.md');
    expect(note.properties).toEqual({ type: 'recipe', cuisine: 'Thai' });
    expect(note.body).toBe('\n## Method\n');
  });

  it('adds a type the button does not offer, as a table’s New does', async () => {
    const api = vault({ '.atlas/settings.md': jsonNote({ quickAdd: ['task'] }) });
    const response = await add(api, { type: 'recipe', name: 'Stew' });
    expect(response.status).toBe(201);
  });

  it('refuses a type the vault does not define as not_found, writing nothing', async () => {
    const api = vault();
    expect(codeOf(await add(api, { type: 'invoice', name: 'Bill' }))).toBe('not_found');
    expect(api.writes).toEqual([]);
  });

  it.each([
    ['no type', { name: 'x' }],
    ['no name', { type: 'task' }],
    ['a blank name', { type: 'task', name: '  ' }],
    ['values that are not text', { type: 'task', name: 'x', values: { estimate: 3 } }],
    ['values that are not an object', { type: 'task', name: 'x', values: ['todo'] }],
  ])('refuses %s as invalid, writing nothing', async (_why, body) => {
    const api = vault();
    expect(codeOf(await add(api, body))).toBe('invalid');
    expect(api.writes).toEqual([]);
  });
});

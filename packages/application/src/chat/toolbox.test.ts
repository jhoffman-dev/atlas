import { describe, expect, it } from 'vitest';
import { apiFixture, VAULT } from '../testing/api-fixture.ts';
import { blockMarkdown } from '../testing/block-markdown.ts';
import { TOOL_RESULT_CHARACTERS } from './read-tools.ts';
import { createChatToolbox } from './toolbox.ts';

function toolbox(files: Record<string, string>, index = {}) {
  const fixture = apiFixture({ files, markdown: blockMarkdown(), index });
  let ids = 0;
  const box = createChatToolbox({
    api: fixture.deps,
    fs: fixture.fs,
    markdown: blockMarkdown(),
    newId: () => `id-${(ids += 1)}`,
  });
  return { fixture, box };
}

describe('the chat toolbox', () => {
  it('offers the read routes and the two proposals, and no write route', () => {
    const names = toolbox({}).box.specs.map((spec) => spec.name);
    expect(names).toContain('atlas_search');
    expect(names).toContain('atlas_read_note');
    expect(names).toContain('atlas_archived');
    expect(names).toEqual(expect.arrayContaining(['propose_edit', 'propose_note']));
    expect(names).not.toContain('atlas_replace_note_body');
    expect(names).not.toContain('atlas_sql');
  });

  it('reads a note through the same route the MCP server calls', async () => {
    const { box } = toolbox({ 'Projects/Q3.md': '---\nstatus: open\n---\nShip it.\n' });
    const { result, proposal } = await box.run({
      id: 'call-1',
      name: 'atlas_read_note',
      input: { path: 'Projects/Q3.md' },
    });
    expect(proposal).toBeNull();
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      note: { path: 'Projects/Q3.md', properties: { status: 'open' }, body: 'Ship it.\n' },
    });
  });

  it('sends every read tool to a route the API has, with the input it was given', async () => {
    const { box } = toolbox({ 'Plan.md': 'x' });
    const inputs: Record<string, Record<string, unknown>> = {
      atlas_search: { q: 'x', limit: 2, includeArchived: true },
      atlas_read_note: { path: 'Plan.md' },
      atlas_list_notes: { folder: 'Projects', limit: 5 },
      atlas_backlinks: { path: 'Plan.md' },
      atlas_list_types: {},
      atlas_list_views: {},
      atlas_list_type_views: { type: 'task' },
      atlas_list_templates: {},
      atlas_read_template: { name: 'Task' },
      atlas_run_view: { path: '.atlas/views/Board.md', includeArchived: true },
      atlas_run_query: { query: 'FROM task', limit: 10 },
      atlas_calendar: { path: '.atlas/views/Cal.md', range: 'week', anchor: '2026-09-22' },
      atlas_tags: { sort: 'frequency' },
      atlas_tagged_notes: { tag: 'idea', limit: 3 },
      atlas_archived: { search: 'old', limit: 4 },
    };
    const readTools = box.specs.filter((spec) => spec.name.startsWith('atlas_'));
    expect(readTools.map((spec) => spec.name).sort()).toEqual(Object.keys(inputs).sort());
    for (const [name, input] of Object.entries(inputs)) {
      const { result } = await box.run({ id: name, name, input });
      // Refusals about the vault's contents are fine here; a route that does not exist is not.
      expect(result.content, name).not.toMatch(/^not_found_route/);
    }
  });

  it('answers a refusal from the route as an error result, not a throw', async () => {
    const { box } = toolbox({});
    const { result } = await box.run({
      id: 'c',
      name: 'atlas_read_note',
      input: { path: 'Nope.md' },
    });
    expect(result).toMatchObject({ isError: true, content: expect.stringMatching(/^not_found: /) });
  });

  it('asks search for archived notes only when the model says so', async () => {
    const scopes: unknown[] = [];
    const { box } = toolbox(
      {},
      {
        search: async (_query: string, _limit: number, scope: unknown) => {
          scopes.push(scope);
          return [];
        },
      },
    );
    await box.run({ id: 'a', name: 'atlas_search', input: { q: 'lease' } });
    await box.run({ id: 'b', name: 'atlas_search', input: { q: 'lease', includeArchived: false } });
    await box.run({ id: 'c', name: 'atlas_search', input: { q: 'lease', includeArchived: true } });
    expect(scopes[0]).toEqual(scopes[1]);
    expect(scopes[2]).not.toEqual(scopes[0]);
    const { result } = await box.run({
      id: 'd',
      name: 'atlas_search',
      input: { q: 'lease', limit: 3 },
    });
    expect(JSON.parse(result.content)).toEqual({ hits: [] });
  });

  it('refuses a read when no vault is open', async () => {
    const { box, fixture } = toolbox({ 'A.md': 'a' });
    expect(fixture.open).toEqual(VAULT);
    fixture.open = null;
    const { result } = await box.run({ id: 'c', name: 'atlas_read_note', input: { path: 'A.md' } });
    expect(result).toMatchObject({ isError: true, content: expect.stringMatching(/^no_vault/) });
  });

  it('cuts a very long result', async () => {
    const { box } = toolbox({ 'Long.md': 'x'.repeat(TOOL_RESULT_CHARACTERS * 2) });
    const { result } = await box.run({
      id: 'c',
      name: 'atlas_read_note',
      input: { path: 'Long.md' },
    });
    // Cut, it is still JSON the model can read, saying it was cut.
    expect(result.content.length).toBeLessThanOrEqual(TOOL_RESULT_CHARACTERS);
    expect(JSON.parse(result.content)).toMatchObject({
      cut: { note: expect.stringMatching(/ask for fewer results/) },
    });
  });

  it('turns propose_edit into a proposal and tells the model it is not yet made', async () => {
    const { box, fixture } = toolbox({ 'Plan.md': 'One.\n' });
    const { result, proposal } = await box.run({
      id: 'call-2',
      name: 'propose_edit',
      input: { path: 'Plan.md', edits: [{ find: 'One.', replace: 'Two.' }] },
    });
    expect(proposal).toMatchObject({ kind: 'edit', id: 'id-1', path: 'Plan.md' });
    expect(result).toMatchObject({
      isError: false,
      content: expect.stringContaining('not written unless'),
    });
    expect(fixture.writes).toEqual([]);
  });

  it('turns propose_note into a proposal', async () => {
    const { box } = toolbox({});
    const { proposal } = await box.run({ id: 'c', name: 'propose_note', input: { title: 'Idea' } });
    expect(proposal).toMatchObject({ kind: 'note', title: 'Idea' });
  });

  it('answers a refused proposal, and an unknown tool, as errors the model can read', async () => {
    const { box } = toolbox({});
    const refused = await box.run({
      id: 'c',
      name: 'propose_edit',
      input: { path: 'Nope.md', append: 'x' },
    });
    expect(refused).toMatchObject({ proposal: null, result: { isError: true } });
    const unknown = await box.run({ id: 'd', name: 'rm_rf', input: {} });
    expect(unknown.result).toMatchObject({ isError: true, content: 'There is no tool "rm_rf".' });
  });
});

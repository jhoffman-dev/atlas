/**
 * The chat's read tools at their edges: an argument that is not text, and an
 * answer too long for the model's context, which must still be JSON it can read.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { READ_TOOL_SPECS, runReadTool, TOOL_RESULT_CHARACTERS } from './read-tools.ts';

const TASK = jsonNote({ name: 'task', label: 'Task', properties: { status: 'text' } });

function vault(files: Record<string, string> = {}) {
  return apiFixture({
    markdown: jsonMarkdown(),
    files: { '.atlas/types/task.md': TASK, ...files },
  });
}

const run = (api: ReturnType<typeof vault>, name: string, input: Record<string, unknown>) =>
  runReadTool({ call: { id: 'c1', name, input }, api: api.deps, requestId: 'r1' });

/** Every tool whose argument is a segment of the route's path, and that argument. */
const IN_THE_PATH: readonly (readonly [string, string])[] = [
  ['atlas_read_note', 'path'],
  ['atlas_backlinks', 'path'],
  ['atlas_list_type_views', 'type'],
  ['atlas_read_template', 'name'],
  ['atlas_run_view', 'path'],
  ['atlas_calendar', 'path'],
  ['atlas_tagged_notes', 'tag'],
];

describe('a read tool whose argument names the route', () => {
  it.each(IN_THE_PATH)(
    '%s refuses a missing, blank or non-text %s as invalid',
    async (name, key) => {
      const api = vault();

      for (const value of [undefined, '', '  ', 7, { name: 'task' }, null]) {
        const result = await run(api, name, value === undefined ? {} : { [key]: value });

        expect(result.isError).toBe(true);
        expect(result.content).toBe(`invalid: ${key} must be a non-empty string.`);
      }
    },
  );
});

describe('atlas_read_template', () => {
  it('answers what a note made from the template starts with', async () => {
    const api = vault({ '.atlas/templates/Task.md': '---\ntype: task\n---\n\n## Notes\n' });

    const result = await run(api, 'atlas_read_template', { name: 'task' });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      template: { name: 'Task', properties: { type: 'task' }, body: '\n## Notes\n' },
    });
  });
});

describe('atlas_list_type_views', () => {
  const views = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, at) => [
        `.atlas/views/V${String(at + 1).padStart(3, '0')}.md`,
        jsonNote({ atlas: 'view', type: 'task', layout: 'table', order: at + 1 }),
      ]),
    );

  it('asks for a page by limit and offset, and answers the total', async () => {
    const api = vault(views(5));

    const result = await run(api, 'atlas_list_type_views', { type: 'task', limit: 2, offset: 2 });
    const body = JSON.parse(result.content) as { views: { title: string }[]; total: number };

    expect(body.views.map((each) => each.title)).toEqual(['V003', 'V004']);
    expect(body).toMatchObject({ total: 5, next: 4 });
  });

  it('tells the model a virtual tab is not a file, and how to read its notes instead', () => {
    const spec = READ_TOOL_SPECS.find((each) => each.name === 'atlas_list_type_views');

    expect(spec?.description).toMatch(/atlas_run_view cannot run it/);
    expect(spec?.description).toMatch(/atlas_run_query "FROM <type>"/);
  });
});

describe('a result too long for the model', () => {
  it('keeps as many whole items as fit, as JSON, and says how many it left out', async () => {
    const api = vault(views400());

    const result = await run(api, 'atlas_list_type_views', { type: 'task', limit: 400 });
    const body = JSON.parse(result.content) as {
      views: unknown[];
      total: number;
      cut: { list: string; shown: number; of: number; note: string };
    };

    expect(result.isError).toBe(false);
    expect(result.content.length).toBeLessThanOrEqual(TOOL_RESULT_CHARACTERS);
    expect(body.total).toBe(400);
    expect(body.cut).toMatchObject({ list: 'views', of: 400 });
    expect(body.cut.shown).toBe(body.views.length);
    expect(body.views.length).toBeGreaterThan(0);
    expect(body.views.length).toBeLessThan(400);
    expect(body.cut.note).toMatch(/ask for fewer/);
  });

  it('answers JSON for one too-long value, holding the start of the answer', async () => {
    const api = vault({
      '.atlas/templates/Long.md': `x${'x'.repeat(TOOL_RESULT_CHARACTERS * 2)}\n`,
    });

    const result = await run(api, 'atlas_read_template', { name: 'Long' });
    const body = JSON.parse(result.content) as { cut: { note: string }; start: string };

    expect(result.content.length).toBeLessThanOrEqual(TOOL_RESULT_CHARACTERS);
    // One item cannot be asked for in fewer results: the cut says what it was and how big.
    expect(body.cut.note).not.toMatch(/ask for fewer/);
    expect(body.cut.note).toMatch(/was cut/);
    expect(body.cut.note).toContain((TOOL_RESULT_CHARACTERS * 2 + 2).toLocaleString('en-US'));
    expect(body.start.startsWith('{"template":')).toBe(true);
  });
});

function views400(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let at = 0; at < 400; at += 1) {
    files[`.atlas/views/Task view number ${String(at).padStart(3, '0')}.md`] = jsonNote({
      atlas: 'view',
      type: 'task',
      layout: 'table',
      order: at + 1,
    });
  }
  return files;
}

/**
 * #415: a long note reached the model cut to its first 30,000 characters,
 * with "ask for fewer results" and no way to read on, so the chat said the
 * note was cut off when the file on disk was whole.
 */
describe('atlas_read_note on a long note (#415)', () => {
  const LAST = 'The last line: the lighthouse keeper rows home at dusk.';

  /** A note of about `bytes` characters, numbered line by line, ending in LAST. */
  function longNote(bytes: number): string {
    const lines: string[] = [];
    for (let at = 0; lines.join('\n').length < bytes; at += 1) {
      lines.push(`Line ${at}: the tide came in over the flats and went out again.`);
    }
    return `${lines.join('\n')}\n${LAST}\n`;
  }

  interface ReadAnswer {
    note: { body: string };
    page?: {
      offset: number;
      shown: number;
      of: number;
      remaining: number;
      next: number | null;
      note: string;
    };
  }

  it('reads a 60 KB note whole, to its last line', async () => {
    const text = longNote(60_000);
    const api = vault({ 'Long.md': text });

    const result = await run(api, 'atlas_read_note', { path: 'Long.md' });
    const body = JSON.parse(result.content) as ReadAnswer & { cut?: unknown };

    expect(result.isError).toBe(false);
    expect(body.cut).toBeUndefined();
    expect(body.note.body).toBe(text);
    expect(body.note.body).toContain(LAST);
  });

  it('pages a note too big for one answer, saying how much is left and how to read it', async () => {
    const text = longNote(300_000);
    const api = vault({ 'Huge.md': text });

    let read = '';
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const input: Record<string, unknown> =
        offset === 0 ? { path: 'Huge.md' } : { path: 'Huge.md', offset };
      const result = await run(api, 'atlas_read_note', input);
      const body = JSON.parse(result.content) as ReadAnswer;
      const page = body.page;

      expect(result.isError).toBe(false);
      if (page === undefined) throw new Error('a cut answer must say it is a page');
      expect(page).toMatchObject({ offset, of: text.length, shown: body.note.body.length });
      expect(page.remaining).toBe(text.length - offset - page.shown);
      if (page.next !== null) {
        expect(page.next).toBe(offset + page.shown);
        expect(page.note).toContain(`offset ${page.next}`);
        expect(page.note).toContain(page.remaining.toLocaleString('en-US'));
      }
      read += body.note.body;
      offset = page.next;
      pages += 1;
      expect(pages).toBeLessThan(20);
    }

    expect(pages).toBeGreaterThan(1);
    expect(read).toBe(text);
    expect(read.endsWith(`${LAST}\n`)).toBe(true);
  });

  it('refuses an offset past the end of the body, saying how long it is', async () => {
    const api = vault({ 'Short.md': 'Only a line.\n' });

    const result = await run(api, 'atlas_read_note', { path: 'Short.md', offset: 500 });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/^invalid: .*13 characters/);
  });

  it('refuses an offset that is not a whole number', async () => {
    const api = vault({ 'Short.md': 'Only a line.\n' });

    for (const offset of [-1, 1.5, '10', true]) {
      const result = await run(api, 'atlas_read_note', { path: 'Short.md', offset });
      expect(result.isError).toBe(true);
      expect(result.content).toBe('invalid: offset must be a whole number, 0 or more.');
    }
  });

  it('tells the model, in its description, how to page a long note', () => {
    const spec = READ_TOOL_SPECS.find((each) => each.name === 'atlas_read_note');
    expect(spec?.description).toMatch(/offset/);
    expect(JSON.stringify(spec?.inputSchema)).toContain('"offset"');
    // A turn has a bounded number of tool rounds: the model says how far it read.
    expect(spec?.description).toMatch(/how far you read/);
  });
});

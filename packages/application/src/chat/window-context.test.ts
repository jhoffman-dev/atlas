import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { apiFixture } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { captureWindowContext } from './window-context.ts';

describe('captureWindowContext', () => {
  it('knows nothing when the window shows nothing', async () => {
    const { deps } = apiFixture();
    expect(await captureWindowContext({ window: { kind: 'none' }, api: deps })).toBeNull();
  });

  it('gives the open note: title, properties and body', async () => {
    const { deps } = apiFixture({ files: { 'Plan.md': '---\nstatus: open\n---\nShip it.\n' } });
    const context = await captureWindowContext({
      window: { kind: 'path', path: createVaultPath('Plan.md') },
      api: deps,
    });
    expect(context).toEqual({
      kind: 'note',
      title: 'Plan',
      path: 'Plan.md',
      text: 'Properties: {"status":"open"}\n\nShip it.\n',
    });
  });

  it("gives a view's first rows", async () => {
    const { deps } = apiFixture({
      markdown: jsonMarkdown(),
      files: { '.atlas/views/Open.md': jsonNote({ atlas: 'view', sql: 'SELECT path FROM files' }) },
      index: { query: async () => ({ columns: ['path'], rows: [['Call.md']], truncated: false }) },
    });
    const context = await captureWindowContext({
      window: { kind: 'path', path: createVaultPath('.atlas/views/Open.md') },
      api: deps,
    });
    expect(context).toMatchObject({ kind: 'view', path: '.atlas/views/Open.md' });
    expect(context?.text).toContain('| path |\n| --- |\n| Call.md |');
  });

  it('gives a query that does not run yet as its text', async () => {
    const { deps } = apiFixture();
    const context = await captureWindowContext({
      window: { kind: 'query', text: 'FROM nowhere WHERE' },
      api: deps,
    });
    expect(context).toEqual({
      kind: 'query',
      title: 'Query',
      path: null,
      text: 'Query: FROM nowhere WHERE\n\n(It does not run yet.)',
    });
  });

  it('knows nothing of a note it cannot read, or an empty query', async () => {
    const { deps } = apiFixture();
    expect(
      await captureWindowContext({
        window: { kind: 'path', path: createVaultPath('Gone.md') },
        api: deps,
      }),
    ).toBeNull();
    expect(
      await captureWindowContext({ window: { kind: 'query', text: ' ' }, api: deps }),
    ).toBeNull();
  });
});

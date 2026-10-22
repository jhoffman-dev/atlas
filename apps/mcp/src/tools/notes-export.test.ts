/**
 * `atlas_export_note` asks the export route for the format it is given —
 * Confluence when none is, as the tool first did — and passes `frontmatter`
 * only when the caller sets it, so the route's own default holds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { AtlasClient } from '../client.ts';
import { createAtlasServer } from '../server.ts';
import { startFakeAtlas, type FakeAtlas } from '../testing/fake-atlas.ts';

const TOKEN = 'export-token';
const EXPORTED = {
  export: {
    path: 'Meetings/Kickoff.md',
    format: 'markdown',
    title: 'Kickoff',
    markdown: 'Ask Mara Quill.\n',
    attachments: [],
  },
};

let atlas: FakeAtlas;
let mcp: Client;

beforeEach(async () => {
  atlas = await startFakeAtlas(() => ({ status: 200, body: EXPORTED }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const connect = async () => ({ baseUrl: atlas.baseUrl, token: TOKEN });
  await createAtlasServer(new AtlasClient({ connect })).connect(serverSide);
  mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(clientSide);
});

afterEach(async () => {
  await mcp.close();
  await atlas.close();
});

const ROUTE = '/v1/notes/Meetings%2FKickoff.md/export';

describe('atlas_export_note', () => {
  it.each([
    [{}, '?format=confluence'],
    [{ format: 'markdown' }, '?format=markdown'],
    [{ format: 'standalone' }, '?format=standalone'],
    [{ format: 'standalone', frontmatter: 'drop' }, '?format=standalone&frontmatter=drop'],
  ])('%j asks the export route for %s', async (args, query) => {
    const result = await mcp.callTool({
      name: 'atlas_export_note',
      arguments: { path: 'Meetings/Kickoff.md', ...args },
    });

    expect(result.isError).not.toBe(true);
    expect(atlas.requests.map((request) => request.url)).toEqual([`${ROUTE}${query}`]);
  });

  it.each([{ format: 'pdf' }, { format: 'google-doc' }, { frontmatter: 'remove' }])(
    'refuses %j before asking DFAI anything',
    async (args) => {
      const result = await mcp.callTool({
        name: 'atlas_export_note',
        arguments: { path: 'Meetings/Kickoff.md', ...args },
      });

      expect(result.isError).toBe(true);
      expect(atlas.requests).toEqual([]);
    },
  );

  it('says why there is no PDF or Google Doc, and where the user makes one', async () => {
    const { tools } = await mcp.listTools();
    const described = tools.find((tool) => tool.name === 'atlas_export_note')?.description ?? '';

    expect(described).toContain('There is no PDF or Google Doc here');
    expect(described).toContain('⌘K "Export…"');
  });
});

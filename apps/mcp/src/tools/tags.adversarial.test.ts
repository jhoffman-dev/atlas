/**
 * Adversarial pass on the tag tools (Phase 20): whatever a prompt-injected
 * client passes as a tag's name, the request stays on a tag route. `new URL`
 * resolves `.` and `..` segments, and encodeURIComponent leaves dots alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { AtlasClient } from '../client.ts';
import { createAtlasServer } from '../server.ts';
import { startFakeAtlas, type FakeAtlas } from '../testing/fake-atlas.ts';

const TOKEN = 'adversarial-token';

let atlas: FakeAtlas;
let mcp: Client;

beforeEach(async () => {
  atlas = await startFakeAtlas(() => ({ status: 200, body: { notes: [], next: null } }));
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

describe('a tag named with dots', () => {
  it.each([
    ['atlas_tagged_notes', { tag: '..' }],
    ['atlas_rename_tag', { tag: '..', to: 'x', dryRun: true }],
    ['atlas_rename_tag', { tag: '.', to: 'x', dryRun: true }],
  ])('%s %j is asked of a /v1/tags/ route, never another', async (name, args) => {
    await mcp.callTool({ name, arguments: args });
    expect(atlas.requests.map((request) => request.url)).toEqual([
      expect.stringMatching(/^\/v1\/tags\/[^/]+\/(notes|rename)/),
    ]);
  });
});

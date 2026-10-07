/**
 * Adversarial pass on the issue #6 view tools. A client trusts
 * `idempotentHint` to retry a call that timed out; atlas_move_card is not
 * idempotent, because a move into "done" rolls a repeating task back to its
 * first status, so the same call sent again finishes it — and moves its date
 * on — a second time (see view-cards.adversarial.test.ts in the application).
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { AtlasClient } from '../client.ts';
import { createAtlasServer } from '../server.ts';
import { startFakeAtlas, type FakeAtlas } from '../testing/fake-atlas.ts';

let atlas: FakeAtlas;
let mcp: Client;

beforeEach(async () => {
  atlas = await startFakeAtlas(() => ({ status: 200, body: {} }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const connect = async () => ({ baseUrl: atlas.baseUrl, token: 'views-token' });
  await createAtlasServer(new AtlasClient({ connect })).connect(serverSide);
  mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(clientSide);
});

afterEach(async () => {
  await mcp.close();
  await atlas.close();
});

it('does not tell clients a card move is safe to retry, since a retry rolls a repeating task twice', async () => {
  const { tools } = await mcp.listTools();
  const moveCard = tools.find((tool) => tool.name === 'atlas_move_card');

  expect(moveCard).toBeDefined();
  expect(moveCard?.annotations?.idempotentHint).toBe(false);
});

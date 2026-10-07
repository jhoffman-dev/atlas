/**
 * Adversarial: `atlas_add_image` driven by a prompt-injected MCP client.
 *
 * `file` makes this server — which runs as the user, with the user's whole
 * disk — read a path the client chose and copy it into the vault. The client
 * itself may have no file access at all (Claude Desktop), so this is a
 * confused deputy: whatever the server reads, the client gains.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { AtlasClient } from '../client.ts';
import { createAtlasServer } from '../server.ts';
import { errorBody, startFakeAtlas, type FakeAtlas } from '../testing/fake-atlas.ts';

/** Settings → Images' limit, as the domain sets it (MAX_IMAGE_BYTES). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let atlas: FakeAtlas;
let mcp: Client;
let folder: string;

beforeEach(async () => {
  // As Atlas does: every chunk is kept until one would take the image past the limit.
  atlas = await startFakeAtlas((request) => {
    const { base64, offset } = (request.body ?? {}) as { base64?: string; offset?: number };
    const size = (offset ?? 0) + Buffer.from(base64 ?? '', 'base64').byteLength;
    if (size > MAX_IMAGE_BYTES) {
      return { status: 400, body: errorBody('invalid', 'An image can be at most 20 MB.') };
    }
    const image = { path: 'attachments/x', size, src: 'x', alt: 'x', markdown: '![x](x)' };
    return { status: 200, body: { image, note: { path: 'Inbox.md' } } };
  });
  folder = await mkdtemp(join(tmpdir(), 'atlas-mcp-image-attack-'));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const connect = async () => ({ baseUrl: atlas.baseUrl, token: 't' });
  await createAtlasServer(new AtlasClient({ connect })).connect(serverSide);
  mcp = new Client({ name: 'test', version: '1.0.0' });
  await mcp.connect(clientSide);
});

afterEach(async () => {
  await mcp.close();
  await atlas.close();
  await rm(folder, { recursive: true, force: true });
});

async function addImage(args: Record<string, unknown>) {
  const result = await mcp.callTool({ name: 'atlas_add_image', arguments: args });
  return { isError: result.isError === true };
}

const sentBytes = () =>
  atlas.requests
    .filter((request) => request.method === 'PUT')
    .map((request) => Buffer.from((request.body as { base64: string }).base64, 'base64'))
    .reduce((all, chunk) => Buffer.concat([all, chunk]), Buffer.alloc(0));

describe('atlas_add_image with a file on disk, attacked', () => {
  it('reads from disk only a file that is itself an image, whatever name it is saved under', async () => {
    // A config file of the kind that holds passwords (Maven, FileZilla, a plist):
    // it starts with "<", which is all an SVG has to.
    const secrets = join(folder, 'settings.xml');
    await writeFile(
      secrets,
      '<?xml version="1.0"?><settings><password>hunter2</password></settings>',
    );

    const result = await addImage({ path: 'Inbox.md', file: secrets, name: 'chart.svg' });

    expect(result.isError).toBe(true);
    expect(sentBytes().toString('utf8')).not.toContain('hunter2');
    expect(atlas.requests).toEqual([]);
  });

  it('refuses a file past the size Atlas allows before sending any of it, leaving no partial image', async () => {
    const big = join(folder, 'huge.png');
    await writeFile(big, Buffer.concat([PNG_HEAD, Buffer.alloc(MAX_IMAGE_BYTES)]));

    const result = await addImage({ path: 'Inbox.md', file: big, insert: false });

    // Atlas refuses only the chunk that crosses the limit; every chunk before it
    // is already a file in the vault, which nothing ever removes.
    expect(result.isError).toBe(true);
    expect(atlas.requests).toEqual([]);
  });
});

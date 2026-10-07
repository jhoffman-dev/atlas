/**
 * `atlas_add_image` end to end over MCP: the image goes up whole, or as an
 * upload in chunks that Atlas puts in place with the last, then its markdown
 * is appended to the note.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { CHUNK_BYTES } from '../artifact-upload.ts';
import { AtlasClient } from '../client.ts';
import { createAtlasServer } from '../server.ts';
import {
  errorBody,
  startFakeAtlas,
  type FakeAtlas,
  type RecordedRequest,
} from '../testing/fake-atlas.ts';

const NOTE = {
  path: 'Work/Plan.md',
  title: 'Plan',
  type: null,
  modified: 3,
  properties: {},
  body: '',
};
const IMAGES_URL = '/v1/notes/Work%2FPlan.md/images/';
const APPEND_URL = '/v1/notes/Work%2FPlan.md/append';
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let atlas: FakeAtlas;
let mcp: Client;
let folder: string;

/**
 * As Atlas answers: an upload's size so far until its last chunk, then the
 * image saved as "<name> 2" (the name was taken).
 */
function atlasAnswer(request: RecordedRequest) {
  if (request.method === 'PUT') {
    const {
      base64,
      offset = 0,
      last = true,
    } = request.body as { base64: string; offset?: number; last?: boolean };
    const size = offset + Buffer.from(base64, 'base64').byteLength;
    if (!last) return { status: offset === 0 ? 202 : 200, body: { upload: { id: 'u1', size } } };
    const asked = decodeURIComponent(request.url.slice(IMAGES_URL.length));
    const name = asked.replace(/\.png$/, ' 2.png');
    const path = `attachments/${name}`;
    const src = `../attachments/${encodeURIComponent(name)}`;
    return {
      status: 201,
      body: { image: { path, size, src, alt: 'shot', markdown: `![shot](${src})` } },
    };
  }
  return { status: 200, body: { note: NOTE } };
}

beforeEach(async () => {
  atlas = await startFakeAtlas(atlasAnswer);
  folder = await mkdtemp(join(tmpdir(), 'atlas-mcp-image-'));
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
  const [first] = result.content as { text: string }[];
  return { isError: result.isError === true, text: first?.text ?? '' };
}

const summary = () =>
  atlas.requests.map(({ method, url, body }) => {
    const { base64, offset, markdown, upload, last } = (body ?? {}) as {
      base64?: string;
      offset?: number;
      markdown?: string;
      upload?: string;
      last?: boolean;
    };
    if (markdown !== undefined) return { method, url, markdown };
    const bytes = Buffer.from(base64 ?? '', 'base64').byteLength;
    return { method, url, offset, upload, last, bytes };
  });

describe('atlas_add_image', () => {
  it('sends a large file from disk as an upload in chunks, the last saying so, then appends it', async () => {
    const size = 2 * CHUNK_BYTES + 10;
    const file = join(folder, 'shot.png');
    await writeFile(file, Buffer.concat([PNG_HEAD, Buffer.alloc(size - PNG_HEAD.byteLength)]));

    const result = await addImage({ path: 'Work/Plan.md', file });

    expect(result.isError).toBe(false);
    const url = `${IMAGES_URL}shot.png`;
    expect(summary()).toEqual([
      { method: 'PUT', url, last: false, bytes: CHUNK_BYTES },
      { method: 'PUT', url, offset: CHUNK_BYTES, upload: 'u1', last: false, bytes: CHUNK_BYTES },
      { method: 'PUT', url, offset: 2 * CHUNK_BYTES, upload: 'u1', last: true, bytes: 10 },
      { method: 'POST', url: APPEND_URL, markdown: '![shot](../attachments/shot%202.png)' },
    ]);
    for (const request of atlas.requests) {
      expect(JSON.stringify(request.body ?? '').length).toBeLessThan(1024 * 1024);
    }
    expect(JSON.parse(result.text)).toMatchObject({
      image: { path: 'attachments/shot 2.png', size },
      note: { path: 'Work/Plan.md' },
    });
  });

  it('takes base64 with a name, and only saves it when insert is false', async () => {
    const result = await addImage({
      path: 'Work/Plan.md',
      base64: PNG_HEAD.toString('base64'),
      name: 'chart.png',
      insert: false,
    });

    expect(result.isError).toBe(false);
    expect(summary()).toEqual([{ method: 'PUT', url: `${IMAGES_URL}chart.png`, bytes: 8 }]);
    expect(JSON.parse(result.text)).not.toHaveProperty('note');
  });

  it.each([
    ['neither file nor base64', {}],
    ['both file and base64', { file: '/tmp/a.png', base64: 'eA==', name: 'a.png' }],
    ['base64 with no name', { base64: 'eA==' }],
    ['base64 that is not base64', { base64: 'not base64!', name: 'a.png' }],
    ['a file that is not there', { file: '/nowhere/at/all.png' }],
    [
      'base64 past 20 MB',
      { base64: Buffer.alloc(20 * 1024 * 1024 + 3).toString('base64'), name: 'a.png' },
    ],
  ])('refuses %s before any request is made', async (_why, args) => {
    const result = await addImage({ path: 'Work/Plan.md', ...args });
    expect(result.isError).toBe(true);
    expect(atlas.requests).toEqual([]);
  });

  it.each([['shot.svg'], ['shot']])(
    'refuses a name (%s) that would save a real image on disk as another kind',
    async (name) => {
      const file = join(folder, 'shot.png');
      await writeFile(file, PNG_HEAD);

      const result = await addImage({ path: 'Work/Plan.md', file, name });

      expect(result).toEqual({
        isError: true,
        text: "name must keep the file's own extension (.png): it cannot change its kind",
      });
      expect(atlas.requests).toEqual([]);
    },
  );

  it('says where the image was saved when the note would not take it', async () => {
    atlas.respondWith((request) =>
      request.method === 'POST'
        ? {
            status: 409,
            body: errorBody('unsaved_in_app', 'Work/Plan.md is open with unsaved edits'),
          }
        : atlasAnswer(request),
    );

    const result = await addImage({
      path: 'Work/Plan.md',
      base64: PNG_HEAD.toString('base64'),
      name: 'a.png',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'The image was saved at attachments/a 2.png, but not added to the note: unsaved_in_app: ' +
        'Work/Plan.md is open with unsaved edits. Add ![shot](../attachments/a%202.png) to it yourself.',
    );
  });

  it('passes on why Atlas refused the image, adding nothing to the note', async () => {
    atlas.respondWith(() => ({
      status: 400,
      body: errorBody('invalid', '“a.png” does not start the way a PNG image does.'),
    }));

    const result = await addImage({ path: 'Work/Plan.md', base64: 'eA==', name: 'a.png' });

    expect(result).toEqual({
      isError: true,
      text: 'invalid: “a.png” does not start the way a PNG image does.',
    });
    expect(atlas.requests.map(({ method }) => method)).toEqual(['PUT']);
  });
});

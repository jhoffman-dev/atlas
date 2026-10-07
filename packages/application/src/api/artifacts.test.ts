import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '@atlas/domain';
import { fakeOpenNotes } from '../testing/fake-ports.ts';
import {
  apiFixture,
  bodyOf,
  codeOf,
  encoded,
  FAKE_PNG,
  OTHER_VAULT,
  TODAY,
} from '../testing/api-fixture.ts';

const PAGE = '<!doctype html><html><head><title>Q3</title></head><body><h1>Q3</h1></body></html>';
const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe('POST /v1/artifacts', () => {
  const save = (api: ReturnType<typeof apiFixture>, body: unknown) =>
    api.send({ method: 'POST', path: '/v1/artifacts', body });

  it('saves the note in artifacts/ and the page beside it, answering 201 with the note', async () => {
    const api = apiFixture();

    const response = await save(api, {
      title: 'Q3 Sales Deck',
      url: 'https://claude.ai/artifact/abc',
      project: 'Atlas',
      tags: ['sales'],
      html: PAGE,
      body: 'Made for the board meeting.',
    });

    expect(response.status).toBe(201);
    expect(decode(api.binaries.get('artifacts/q3-sales-deck/index.html'))).toBe(PAGE);
    const note = bodyOf(response)['note'] as Record<string, unknown>;
    expect(note).toMatchObject({ path: 'artifacts/Q3 Sales Deck.md', type: 'artifact' });
    expect(note['properties']).toMatchObject({
      url: 'https://claude.ai/artifact/abc',
      kind: 'page',
      project: '[[Atlas]]',
      saved: 'artifacts/q3-sales-deck',
      saved_at: TODAY,
    });
    expect(note['body']).toBe('Made for the board meeting.');
  });

  it('keeps only the link when no html is sent, and numbers a title that is taken', async () => {
    const api = apiFixture({ files: { 'artifacts/Notes.md': '' } });

    const response = await save(api, { title: 'Notes', url: 'https://claude.ai/artifact/x' });

    expect(response.status).toBe(201);
    const note = bodyOf(response)['note'] as { path: string; properties: object };
    expect(note.path).toBe('artifacts/Notes 2.md');
    expect(note.properties).not.toHaveProperty('saved');
    expect(api.binaries.size).toBe(0);
  });

  it('starts from the Artifact template when the vault has one', async () => {
    const api = apiFixture({
      files: {
        '.atlas/templates/Artifact.md': '---\ntype: artifact\nkind: other\n---\n\n## Why\n',
      },
    });
    const response = await save(api, { title: 'T', kind: 'deck' });
    const note = bodyOf(response)['note'] as { body: string; properties: object };
    expect(note.body).toBe('\n## Why\n');
    expect(note.properties).toMatchObject({ kind: 'deck' });
  });

  it.each([
    ['no title', { url: 'https://claude.ai/artifact/x' }],
    ['a blank title', { title: '  ' }],
    ['a link that is not http', { title: 'T', url: 'javascript:alert(1)' }],
    ['an unknown kind', { title: 'T', kind: 'slides' }],
    ['tags that are not strings', { title: 'T', tags: [1] }],
    ['html that is not a string', { title: 'T', html: 3 }],
    ['a body that is not an object', 'hello'],
  ])('refuses %s as invalid, writing nothing', async (_why, body) => {
    const api = apiFixture();
    const response = await save(api, body);
    expect(codeOf(response)).toBe('invalid');
    expect(api.writes).toEqual([]);
    expect(api.binaries.size).toBe(0);
  });

  it('refuses with no_vault once the vault it was for has closed', async () => {
    const api = apiFixture();
    api.open = null;
    expect(codeOf(await save(api, { title: 'T' }))).toBe('no_vault');
  });
});

describe('PUT /v1/artifacts/{path}/files/{name}', () => {
  const NOTE = '---\ntype: artifact\nkind: page\n---\n';
  const put = (
    api: ReturnType<typeof apiFixture>,
    name: string,
    body: unknown,
    note = 'artifacts/Big.md',
  ) =>
    api.send({
      method: 'PUT',
      path: `/v1/artifacts/${encoded(note)}/files/${encoded(name)}`,
      body,
    });

  it('makes the copy folder on the first chunk, records it, and appends later chunks', async () => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });

    const first = await put(api, 'index.html', { text: '<html>' });
    const second = await put(api, 'index.html', { text: '</html>', offset: 6 });

    expect(first.status).toBe(201);
    expect(bodyOf(first)).toEqual({ file: { path: 'artifacts/big/index.html', size: 6 } });
    expect(bodyOf(second)).toEqual({ file: { path: 'artifacts/big/index.html', size: 13 } });
    expect(decode(api.binaries.get('artifacts/big/index.html'))).toBe('<html></html>');
    expect(api.files.get('artifacts/Big.md')?.text).toContain('saved: artifacts/big');
    expect(api.files.get('artifacts/Big.md')?.text).toContain(`saved_at: ${TODAY}`);
  });

  it('writes a picture sent as base64 into a folder of its own, leaving the cover to the thumbnail', async () => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    const png = new Uint8Array([137, 80, 78, 71]);

    const response = await put(api, 'img/logo.png', { base64: encodeBase64(png) });

    expect(response.status).toBe(201);
    expect(api.binaries.get('artifacts/big/img/logo.png')).toEqual(png);
    expect(api.folders.has('artifacts/big/img')).toBe(true);
    expect(api.files.get('artifacts/Big.md')?.text).not.toContain('cover:');
  });

  it("writes into the folder the note's saved names, and leaves the note alone after that", async () => {
    const api = apiFixture({
      files: {
        'artifacts/Big.md': `${NOTE.slice(0, -4)}saved: artifacts/older-copy\ncover: a.png\n---\n`,
      },
    });
    api.folders.add('artifacts/older-copy');
    const writesBefore = api.writes.length;

    await put(api, 'b.png', { base64: 'AA==' });

    expect(api.binaries.has('artifacts/older-copy/b.png')).toBe(true);
    expect(api.writes.length).toBe(writesBefore);
  });

  it('goes through the pane when the note is open, so its editor does not save over it', async () => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    const through: unknown[] = [];
    api.deps = {
      ...api.deps,
      openNotes: fakeOpenNotes({
        setPropertiesIfOpen: async ({ values }) => {
          through.push(values);
          return true;
        },
      }),
    };

    await put(api, 'index.html', { text: 'x' });

    expect(through).toEqual([{ saved: 'artifacts/big', saved_at: TODAY }]);
    expect(api.files.get('artifacts/Big.md')?.text).toBe(NOTE);
  });

  it('refuses a first chunk for a file that is there as exists, and an out-of-order one as conflict', async () => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    await put(api, 'index.html', { text: 'abc' });

    expect(codeOf(await put(api, 'index.html', { text: 'again' }))).toBe('exists');
    expect(codeOf(await put(api, 'index.html', { text: 'x', offset: 2 }))).toBe('conflict');
    expect(codeOf(await put(api, 'app.js', { text: 'x', offset: 5 }))).toBe('not_found');
    expect(decode(api.binaries.get('artifacts/big/index.html'))).toBe('abc');
  });

  it.each([
    ['a climb out of the copy', '../Big.md'],
    ['a hidden file', '.env.json'],
    ['a note', 'README.md'],
    ['an executable', 'run.sh'],
    ['bad percent-encoding', '%E0%A4%A'],
  ])('refuses %s as a file name', async (_why, name) => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    const response = await api.send({
      method: 'PUT',
      path: `/v1/artifacts/${encoded('artifacts/Big.md')}/files/${name.startsWith('%') ? name : encoded(name)}`,
      body: { text: 'x' },
    });
    expect(codeOf(response)).toBe('invalid');
    expect(api.binaries.size).toBe(0);
  });

  it.each([
    ['both text and base64', { text: 'x', base64: 'AA==' }],
    ['neither', {}],
    ['base64 that is not', { base64: 'not base64!' }],
    ['a negative offset', { text: 'x', offset: -1 }],
    ['a fractional offset', { text: 'x', offset: 1.5 }],
    ['a file past 32 MB', { text: 'x', offset: 32 * 1024 * 1024 }],
  ])('refuses %s', async (_why, body) => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    expect(codeOf(await put(api, 'index.html', body))).toBe('invalid');
    expect(api.folders.size).toBe(0);
  });

  it('refuses a note that is not an artifact, and one that is not there', async () => {
    const api = apiFixture({ files: { 'Tasks/Call.md': '---\ntype: task\n---\n' } });
    expect(codeOf(await put(api, 'index.html', { text: 'x' }, 'Tasks/Call.md'))).toBe('invalid');
    expect(codeOf(await put(api, 'index.html', { text: 'x' }, 'artifacts/Gone.md'))).toBe(
      'not_found',
    );
  });

  it('refuses a saved folder in .atlas, and a copy folder that is a file', async () => {
    const atlas = apiFixture({
      files: { 'artifacts/Big.md': `${NOTE.slice(0, -4)}saved: .atlas/types\n---\n` },
    });
    expect(codeOf(await put(atlas, 'index.html', { text: 'x' }))).toBe('invalid');

    const clash = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    clash.binaries.set('artifacts/big', new Uint8Array());
    expect(codeOf(await put(clash, 'index.html', { text: 'x' }))).toBe('invalid');
  });

  it('refuses with no_vault when another vault opened before the write', async () => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    const listDirectory = api.deps.fs.listDirectory;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        listDirectory: async (path) => {
          api.open = OTHER_VAULT;
          return listDirectory(path);
        },
      },
    };
    expect(codeOf(await put(api, 'index.html', { text: 'x' }))).toBe('no_vault');
    expect(api.binaries.size).toBe(0);
  });
});

describe('POST /v1/artifacts/{path}/thumbnail', () => {
  const NOTE = '---\ntype: artifact\nsaved: artifacts/big\n---\n';
  const THUMBNAIL = 'artifacts/big/atlas-thumbnail.png';
  const thumbnail = (api: ReturnType<typeof apiFixture>, note = 'artifacts/Big.md') =>
    api.send({ method: 'POST', path: `/v1/artifacts/${encoded(note)}/thumbnail`, body: null });
  const withCopy = (text = NOTE) => {
    const api = apiFixture({ files: { 'artifacts/Big.md': text } });
    api.folders.add('artifacts/big');
    api.binaries.set('artifacts/big/index.html', new TextEncoder().encode(PAGE));
    return api;
  };

  it('pictures the copy, keeps the picture in it, and answers with the note fronted by it', async () => {
    const api = withCopy();

    const response = await thumbnail(api);

    expect(response.status).toBe(200);
    expect(api.binaries.get(THUMBNAIL)).toEqual(FAKE_PNG);
    const note = bodyOf(response)['note'] as Record<string, unknown>;
    expect(note['properties']).toMatchObject({ cover: 'big/atlas-thumbnail.png' });
  });

  it('is made in the shared queue, so the gallery sees it made', async () => {
    const api = withCopy();
    const seen: (string | undefined)[] = [];
    api.thumbnails.subscribe(() =>
      seen.push(api.thumbnails.snapshot().state('artifacts/Big.md')?.kind),
    );

    const response = await thumbnail(api);

    expect(response.status).toBe(200);
    expect(seen).toContain('generating');
    expect(api.thumbnails.snapshot().made('artifacts/Big.md')).toBe(1);
  });

  it('leaves a cover set by hand as it is', async () => {
    const api = withCopy(`${NOTE.slice(0, -4)}cover: photos/me.jpg\n---\n`);
    const response = await thumbnail(api);
    expect(response.status).toBe(200);
    expect(api.binaries.has(THUMBNAIL)).toBe(false);
    expect((bodyOf(response)['note'] as { properties: object }).properties).toMatchObject({
      cover: 'photos/me.jpg',
    });
  });

  it('says why when the page cannot be pictured, leaving the note as it was', async () => {
    const api = withCopy();
    api.snapshot = {
      capture: () => Promise.reject(new Error('thumbnails are made on macOS only')),
    };
    const before = api.files.get('artifacts/Big.md')?.text;

    const response = await thumbnail(api);

    expect(response.status).toBe(422);
    expect(codeOf(response)).toBe('thumbnail_failed');
    expect(JSON.stringify(response.body)).toContain('thumbnails are made on macOS only');
    expect(api.files.get('artifacts/Big.md')?.text).toBe(before);
  });

  it('refuses a note that is not an artifact, one with no copy, and one that is not there', async () => {
    const api = apiFixture({
      files: {
        'Tasks/Call.md': '---\ntype: task\n---\n',
        'artifacts/Link.md': '---\ntype: artifact\n---\n',
      },
    });
    expect(codeOf(await thumbnail(api, 'Tasks/Call.md'))).toBe('invalid');
    expect(codeOf(await thumbnail(api, 'artifacts/Link.md'))).toBe('invalid');
    expect(codeOf(await thumbnail(api, 'artifacts/Gone.md'))).toBe('not_found');
  });

  it('keeps the name for Atlas: no file of the copy may take it', async () => {
    const api = withCopy();
    const response = await api.send({
      method: 'PUT',
      path: `/v1/artifacts/${encoded('artifacts/Big.md')}/files/${encoded('atlas-thumbnail.png')}`,
      body: { base64: encodeBase64(FAKE_PNG) },
    });
    expect(codeOf(response)).toBe('invalid');
    expect(api.binaries.has(THUMBNAIL)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { encodeBase64, MAX_IMAGE_BYTES } from '@atlas/domain';
import {
  apiFixture,
  bodyOf,
  codeOf,
  encoded,
  FAKE_PNG,
  OTHER_VAULT,
} from '../testing/api-fixture.ts';

/*
 * U-12 through the local API: an image saved for a note, where Settings →
 * Images puts it, in chunks for one past the host's 1 MiB body cap.
 */

const NOTE = 'Work/Plan.md';
const PLAN = '---\ntype: project\n---\n\n# Plan\n';
const TAIL = Uint8Array.from([1, 2, 3, 4]);

type Api = ReturnType<typeof apiFixture>;

const put = (api: Api, name: string, body: unknown, note = NOTE) =>
  api.send({
    method: 'PUT',
    path: `/v1/notes/${encoded(note)}/images/${encoded(name)}`,
    body,
  });

const png = (bytes: Uint8Array = FAKE_PNG) => ({ base64: encodeBase64(bytes) });

const vault = () => apiFixture({ files: { [NOTE]: PLAN } });

describe('PUT /v1/notes/{path}/images/{name}', () => {
  it('saves the image in attachments/, making it, and answers how the note shows it', async () => {
    const api = vault();

    const response = await put(api, 'Q3 chart.png', png());

    expect(response.status).toBe(201);
    expect(bodyOf(response)).toEqual({
      image: {
        path: 'attachments/Q3 chart.png',
        size: FAKE_PNG.byteLength,
        src: '../attachments/Q3%20chart.png',
        alt: 'Q3 chart',
        markdown: '![Q3 chart](../attachments/Q3%20chart.png)',
      },
    });
    expect(api.binaries.get('attachments/Q3 chart.png')).toEqual(FAKE_PNG);
    expect(api.folders.has('attachments')).toBe(true);
    // The note is the caller's to change, with append or body.
    expect(api.writes).toEqual([]);
    expect(api.files.get(NOTE)?.text).toBe(PLAN);
  });

  it('puts it beside the note when Settings → Images says so', async () => {
    const api = vault();
    api.placement = 'beside-note';

    const response = await put(api, 'chart.png', png());

    expect(bodyOf(response)['image']).toMatchObject({ path: 'Work/chart.png', src: 'chart.png' });
    expect(api.binaries.has('Work/chart.png')).toBe(true);
  });

  it('numbers a name that is taken in any case, never writing over the image there', async () => {
    const api = vault();
    const theirs = Uint8Array.from([...FAKE_PNG, 9]);
    api.binaries.set('attachments/Chart.png', theirs);

    const response = await put(api, 'chart.png', png());

    expect(bodyOf(response)['image']).toMatchObject({ path: 'attachments/chart 2.png' });
    expect(api.binaries.get('attachments/Chart.png')).toEqual(theirs);
  });

  it('stages a large image outside the notes, and moves it into place, numbered, with its last chunk', async () => {
    const api = vault();
    api.binaries.set('attachments/big.png', FAKE_PNG);

    const first = await put(api, 'big.png', { ...png(), last: false });
    const staged = [...api.binaries.keys()];
    const next = await put(api, 'big.png', {
      base64: encodeBase64(TAIL),
      offset: FAKE_PNG.byteLength,
      upload: 'upload-1',
    });

    expect(first.status).toBe(202);
    expect(bodyOf(first)).toEqual({ upload: { id: 'upload-1', size: FAKE_PNG.byteLength } });
    expect(staged).toEqual(['attachments/big.png', '.atlas-cache/uploads/upload-1']);
    expect(next.status).toBe(201);
    expect(bodyOf(next)['image']).toMatchObject({ path: 'attachments/big 2.png', size: 13 });
    expect(api.binaries.get('attachments/big 2.png')).toEqual(
      Uint8Array.from([...FAKE_PNG, ...TAIL]),
    );
    expect(api.binaries.get('attachments/big.png')).toEqual(FAKE_PNG);
    expect([...api.binaries.keys()].some((path) => path.startsWith('.atlas-cache/'))).toBe(false);
  });

  it('answers each chunk before the last with the size so far, placing nothing yet', async () => {
    const api = vault();
    await put(api, 'big.png', { ...png(), last: false });

    const middle = await put(api, 'big.png', {
      base64: encodeBase64(TAIL),
      offset: FAKE_PNG.byteLength,
      upload: 'upload-1',
      last: false,
    });

    expect(middle.status).toBe(200);
    expect(bodyOf(middle)).toEqual({ upload: { id: 'upload-1', size: 13 } });
    expect(api.binaries.has('attachments/big.png')).toBe(false);
  });

  it('checks the whole image with its last chunk: a script sent after a clean start is refused', async () => {
    const api = vault();
    await put(api, 'chart.svg', { text: '<svg xmlns="http://www.w3.org/2000/svg">', last: false });

    const last = await put(api, 'chart.svg', {
      text: '<script>alert(1)</script></svg>',
      offset: 40,
      upload: 'upload-1',
    });

    expect(codeOf(last)).toBe('invalid');
    expect(api.binaries.has('attachments/chart.svg')).toBe(false);
  });

  it('checks the first chunk of an upload before staging it', async () => {
    const api = vault();

    const response = await put(api, 'fake.png', { text: '<html>', last: false });

    expect(codeOf(response)).toBe('invalid');
    expect(api.binaries.size).toBe(0);
  });

  it('takes an SVG sent as text', async () => {
    const api = vault();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

    const response = await put(api, 'dot.svg', { text: svg });

    expect(response.status).toBe(201);
    expect(new TextDecoder().decode(api.binaries.get('attachments/dot.svg'))).toBe(svg);
  });

  it.each([
    ['a file a note cannot hold', 'notes.txt', png()],
    ['bytes that are not the image the name says', 'fake.png', { text: '<html>' }],
    ['an empty image', 'empty.png', { base64: '' }],
    ['a hidden name', '.hidden.png', png()],
    ['a name with a folder in it', 'img/a.png', png()],
    ['both text and base64', 'a.png', { text: 'x', base64: 'eA==' }],
    ['base64 that is not base64', 'a.png', { base64: '!!' }],
    ['an offset that is not a whole number', 'a.png', { ...png(), offset: -1 }],
    ['a first chunk that names an upload', 'a.png', { ...png(), upload: 'upload-1' }],
    ['a last that is not true or false', 'a.png', { ...png(), last: 'yes' }],
    ['a next chunk with no upload id', 'a.png', { ...png(TAIL), offset: 9 }],
  ])('refuses %s as invalid, writing nothing', async (_why, name, body) => {
    const api = vault();

    const response = await put(api, name, body);

    expect(codeOf(response)).toBe('invalid');
    expect(api.binaries.size).toBe(0);
    expect(api.folders.size).toBe(0);
  });

  it('refuses a chunk that would take the image past the size the app allows', async () => {
    const api = vault();
    await put(api, 'big.png', { ...png(), last: false });

    const response = await put(api, 'big.png', {
      ...png(TAIL),
      offset: MAX_IMAGE_BYTES,
      upload: 'upload-1',
    });

    expect(codeOf(response)).toBe('invalid');
    expect(api.binaries.get('.atlas-cache/uploads/upload-1')).toEqual(FAKE_PNG);
    expect(api.binaries.has('attachments/big.png')).toBe(false);
  });

  it('saves a staged image under the name its last chunk gives, cleaned as any name is', async () => {
    const api = vault();
    await put(api, 'a.png', { ...png(), last: false });

    const response = await put(api, 'a:b.png', { ...png(TAIL), offset: 9, upload: 'upload-1' });

    expect(response.status).toBe(201);
    expect(bodyOf(response)['image']).toMatchObject({ path: 'attachments/a b.png' });
  });

  it('refuses a next chunk at the wrong offset as conflict, and one to no upload as not_found', async () => {
    const api = vault();
    await put(api, 'big.png', { ...png(), last: false });

    const wrong = await put(api, 'big.png', { ...png(TAIL), offset: 3, upload: 'upload-1' });
    const unknown = await put(api, 'big.png', { ...png(TAIL), offset: 9, upload: 'upload-7' });
    const climbing = await put(api, 'big.png', {
      ...png(TAIL),
      offset: 9,
      upload: '../../attachments/big.png',
    });

    expect(codeOf(wrong)).toBe('conflict');
    expect(codeOf(unknown)).toBe('not_found');
    expect(codeOf(climbing)).toBe('not_found');
    expect([...api.binaries.keys()]).toEqual(['.atlas-cache/uploads/upload-1']);
    expect(api.binaries.get('.atlas-cache/uploads/upload-1')).toEqual(FAKE_PNG);
  });

  it('refuses an image for a note that is not there, or is not in user space', async () => {
    const api = vault();
    expect(codeOf(await put(api, 'a.png', png(), 'Missing.md'))).toBe('not_found');
    expect(codeOf(await put(api, 'a.png', png(), '.atlas/types/task.md'))).toBe('invalid');
    expect(api.binaries.size).toBe(0);
  });

  it('writes nothing into the vault another is switched to while it is saved', async () => {
    const api = vault();
    const { listDirectory } = api.deps.fs;
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

    expect(codeOf(await put(api, 'a.png', png()))).toBe('no_vault');
    expect(api.binaries.size).toBe(0);
  });

  it('says why when the image folder cannot be made, as conflict', async () => {
    const api = apiFixture({ files: { [NOTE]: PLAN, attachments: 'a file, not a folder' } });

    const response = await put(api, 'a.png', png());

    expect(codeOf(response)).toBe('conflict');
    expect(api.binaries.size).toBe(0);
  });
});

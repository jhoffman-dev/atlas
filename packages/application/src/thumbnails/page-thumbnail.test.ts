import { describe, expect, it, vi } from 'vitest';
import {
  createVaultPath,
  MAX_PAGE_IMAGE_BYTES,
  MAX_PAGE_IMAGES_BYTES,
  pageThumbnailPath,
  pageThumbnailRecord,
  pageThumbnailStale,
  parseObjectType,
  THUMBNAIL_SHOT,
  type EditorDocument,
} from '@atlas/domain';
import type { PageSnapshotPort } from '../artifacts/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { setNoteProperties, type PropertyChanges } from '../query/set-property.ts';
import { apiFixture } from '../testing/api-fixture.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { generateThumbnail } from './generate-thumbnail.ts';
import { generatePageThumbnail, picturedPages } from './page-thumbnail.ts';
import { ThumbnailRefusedError, type NotePageRenderer } from './ports.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const NOTE_PATH = createVaultPath('Books/Dune.md');
const CACHED = pageThumbnailPath(NOTE_PATH);

const BODY: EditorDocument = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Dune' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A desert planet.' }] },
    { type: 'image', attrs: { src: 'sand.png' } },
    { type: 'image', attrs: { src: 'https://example.test/far.png' } },
    { type: 'image', attrs: { src: 'missing.png' } },
  ],
};

/** Markdown whose every body reads as `doc`. */
const bodyMarkdown = (doc: EditorDocument = BODY): MarkdownPort => ({
  ...fakeMarkdown(),
  parseBody: () => ({ doc, blocks: [] }),
});

/** Draws the body as its JSON, so a test can see what reached the renderer. */
const renderer: NotePageRenderer = { bodyHtml: (doc) => JSON.stringify(doc), styles: 'p{}' };

function setUp({
  frontmatter = 'type: book\n',
  picture = async () => PNG,
  doc = BODY,
}: { frontmatter?: string; picture?: PageSnapshotPort['capture']; doc?: EditorDocument } = {}) {
  const api = apiFixture({
    files: { [NOTE_PATH]: `---\n${frontmatter}---\n\nbody\n` },
    markdown: bodyMarkdown(doc),
  });
  api.folders.add('Books');
  api.binaries.set('Books/sand.png', Uint8Array.from([1, 2, 3]));
  const { fs } = api;
  const snapshot = { capture: vi.fn(picture) };
  const setProperties = vi.fn((values: PropertyChanges) =>
    setNoteProperties({
      today: '2026-10-08',
      fs,
      markdown: api.deps.markdown,
      path: NOTE_PATH,
      values,
    }),
  );
  const deps = { fs, markdown: api.deps.markdown, snapshot, renderer };
  const generate = (asked = false) =>
    generatePageThumbnail({ deps, notePath: NOTE_PATH, thumbnailKey: 'art', asked, setProperties });
  const noteText = () => api.files.get(NOTE_PATH)?.text ?? '';
  return { api, snapshot, setProperties, generate, noteText, deps };
}

describe('generatePageThumbnail', () => {
  it('pictures the page as it reads and keeps the picture in the cache, leaving the note alone', async () => {
    const { api, snapshot, generate, noteText, setProperties } = setUp();
    const before = noteText();

    const result = await generate();

    expect(result).toEqual({ kind: 'made', path: CACHED, cover: `/${CACHED}` });
    expect(api.binaries.get(CACHED)).toEqual(PNG);
    expect(noteText()).toBe(before);
    expect(setProperties).not.toHaveBeenCalled();

    const request = snapshot.capture.mock.calls[0]?.[0];
    expect(request).toMatchObject(THUMBNAIL_SHOT);
    const html = request?.html ?? '';
    expect(html).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy"/);
    expect(html).toContain('<title>Dune</title>');
    expect(html).toContain('A desert planet.');
    // The heading that only repeats the title is not drawn twice.
    expect(html).not.toContain('"heading"');
    // A vault image is written in; a web one and a missing one are left out.
    expect(html).toContain('data:image/png;base64,AQID');
    expect(html).not.toContain('example.test');
    expect(html).not.toContain('missing.png');
  });

  it('never looks in the vault for an image on the web', async () => {
    const asked: string[] = [];
    const fs = fakeVaultFs({
      readTextFile: async () => ({ text: '---\ntype: book\n---\n', modified: 1 }),
      // Every image a body names is there, as far as the listing says.
      listDirectory: async (folder) =>
        ['sand.png', 'missing.png', 'far.png'].map((name) => ({
          kind: 'file' as const,
          name,
          path: createVaultPath(folder === '' ? name : `${folder}/${name}`),
          size: 1,
        })),
      readBinaryFile: async (path) => {
        asked.push(path);
        return Uint8Array.from([1]).buffer;
      },
    });
    await generatePageThumbnail({
      deps: { fs, markdown: bodyMarkdown(), snapshot: { capture: async () => PNG }, renderer },
      notePath: NOTE_PATH,
      thumbnailKey: 'art',
      asked: false,
      setProperties: async () => {},
    });
    expect(asked).toEqual(['Books/sand.png', 'Books/missing.png']);
  });

  it('replaces the picture it made before', async () => {
    const { api, generate } = setUp();
    await generate();
    api.binaries.set(CACHED, Uint8Array.from([0]));
    await generate();
    expect(api.binaries.get(CACHED)).toEqual(PNG);
  });

  it.each(['art: attachments/me.png\n', 'art: false\n'])(
    'leaves a note that chose or cleared its picture alone, unasked (%s)',
    async (value) => {
      const { snapshot, generate, api } = setUp({ frontmatter: `type: book\n${value}` });
      await expect(generate()).resolves.toEqual({ kind: 'kept' });
      expect(snapshot.capture).not.toHaveBeenCalled();
      expect(api.binaries.has(CACHED)).toBe(false);
    },
  );

  it('asked, pictures it anyway and puts the value back to auto', async () => {
    const { generate, noteText, api } = setUp({ frontmatter: 'type: book\nart: false\n' });
    await generate(true);
    expect(noteText()).toContain('art: auto');
    expect(api.binaries.get(CACHED)).toEqual(PNG);
  });

  it('refuses what is not a PNG, changing nothing', async () => {
    const { generate, api, noteText } = setUp({
      frontmatter: 'type: book\nart: false\n',
      picture: async () => Uint8Array.from([1, 2, 3]),
    });
    const before = noteText();
    await expect(generate(true)).rejects.toBeInstanceOf(ThumbnailRefusedError);
    expect(api.binaries.has(CACHED)).toBe(false);
    expect(noteText()).toBe(before);
  });

  it('passes on the host refusing to picture it', async () => {
    const { generate } = setUp({
      picture: async () => {
        throw new Error('thumbnails are made on macOS only');
      },
    });
    await expect(generate()).rejects.toThrow('thumbnails are made on macOS only');
  });

  it('makes the cache folders when they are not there, and reports a write that still fails', async () => {
    const created: string[] = [];
    let writes = 0;
    const fs = fakeVaultFs({
      readTextFile: async () => ({ text: '---\ntype: book\n---\n', modified: 1 }),
      createFolder: async ({ path }) => {
        created.push(path);
        if (path === '.atlas-cache') throw new Error('that name is taken');
      },
      writeBinaryFile: async () => {
        writes += 1;
        throw new Error(writes === 1 ? 'that folder does not exist' : 'the disk is full');
      },
    });
    const snapshot = { capture: async () => PNG };
    await expect(
      generatePageThumbnail({
        deps: { fs, markdown: bodyMarkdown(), snapshot, renderer },
        notePath: NOTE_PATH,
        thumbnailKey: 'art',
        asked: false,
        setProperties: async () => {},
      }),
    ).rejects.toThrow('the disk is full');
    expect(created).toEqual(['.atlas-cache', '.atlas-cache/thumbnails']);
    expect(writes).toBe(2);
  });
});

describe('which version of the note a picture is of', () => {
  const noteModified = (api: ReturnType<typeof setUp>['api']) =>
    api.files.get(NOTE_PATH)?.modified ?? Number.NaN;

  it('is recorded beside the picture: the version it read', async () => {
    const { api, generate } = setUp();
    const read = noteModified(api);
    await generate();
    const pictured = await picturedPages(api.fs);
    expect(pictured.get(CACHED)).toBe(read);
    expect(pageThumbnailStale({ noteModified: noteModified(api), picturedAt: read })).toBe(false);
  });

  it('a save landing while the page is pictured leaves the picture of the version it saw', async () => {
    const holder: { api?: ReturnType<typeof setUp>['api'] } = {};
    const { api, generate } = setUp({
      doc: { type: 'doc', content: [] },
      picture: async () => {
        // A pane's autosave, while the page loads in its own process.
        await holder.api?.fs.writeTextFile({
          path: NOTE_PATH,
          contents: '---\ntype: book\n---\n\nsecond draft\n',
          expectedModified: null,
        });
        return PNG;
      },
    });
    holder.api = api;
    const read = noteModified(api);
    await generate();

    const picturedAt = (await picturedPages(api.fs)).get(CACHED) ?? null;
    expect(picturedAt).toBe(read);
    expect(pageThumbnailStale({ noteModified: noteModified(api), picturedAt })).toBe(true);
  });

  it('asked, is the version given `auto`: only its properties changed, not its page', async () => {
    const { api, generate } = setUp({ frontmatter: 'type: book\nart: false\n' });
    await generate(true);
    const picturedAt = (await picturedPages(api.fs)).get(CACHED) ?? null;
    expect(pageThumbnailStale({ noteModified: noteModified(api), picturedAt })).toBe(false);
  });
});

describe('the images written into a page', () => {
  const image = (src: string) => ({ type: 'image', attrs: { src } });

  it('never reads one the listing says is too big', async () => {
    const { api, generate, snapshot } = setUp({
      doc: { type: 'doc', content: [image('huge.png')] },
    });
    api.binaries.set('Books/huge.png', new Uint8Array(MAX_PAGE_IMAGE_BYTES + 1));
    const reads = vi.spyOn(api.fs, 'readBinaryFile');
    await generate();
    expect(reads).not.toHaveBeenCalled();
    expect(snapshot.capture.mock.calls[0]?.[0].html).not.toContain('data:image');
  });

  it('finds one written in another case, as a disk that ignores case does', async () => {
    const { generate, snapshot } = setUp({ doc: { type: 'doc', content: [image('Sand.PNG')] } });
    await generate();
    expect(snapshot.capture.mock.calls[0]?.[0].html).toContain('base64,AQID');
  });

  it('leaves out those past what one page may hold, all together', async () => {
    const each = Math.floor(MAX_PAGE_IMAGES_BYTES / 3) + 1;
    const names = ['one.png', 'two.png', 'three.png'];
    const { api, generate } = setUp({ doc: { type: 'doc', content: names.map(image) } });
    for (const name of names) api.binaries.set(`Books/${name}`, new Uint8Array(each));
    const reads = vi.spyOn(api.fs, 'readBinaryFile');
    await generate();
    expect(reads.mock.calls.map(([path]) => path)).toEqual(['Books/one.png', 'Books/two.png']);
  });
});

describe('picturedPages', () => {
  it('says which version of its note each picture is of, by the picture’s path', async () => {
    const api = apiFixture();
    const cache = (name: string, text: string) =>
      api.binaries.set(`.atlas-cache/thumbnails/${name}`, new TextEncoder().encode(text));
    cache('a.png', 'png');
    cache('a.json', pageThumbnailRecord(5));
    // A picture with no record, a record with no picture, and a record that is not one.
    cache('b.png', 'png');
    cache('c.json', pageThumbnailRecord(6));
    cache('d.png', 'png');
    cache('d.json', 'garbage');
    expect([...(await picturedPages(api.fs))]).toEqual([['.atlas-cache/thumbnails/a.png', 5]]);
  });

  it('is empty before the cache is there', async () => {
    const fs = fakeVaultFs({
      listDirectory: async () => {
        throw new Error('no such entry');
      },
    });
    expect((await picturedPages(fs)).size).toBe(0);
  });
});

describe('generateThumbnail', () => {
  const book = parseObjectType({ name: 'book', properties: { art: 'thumbnail' } });

  it("pictures a note's page under its type's thumbnail property", async () => {
    const { deps, setProperties, api } = setUp({ frontmatter: 'type: book\nart: false\n' });
    await generateThumbnail({
      deps,
      typeOf: (name) => (name === 'book' ? book : undefined),
      notePath: NOTE_PATH,
      asked: true,
      unsaved: false,
      setProperties,
    });
    expect(api.files.get(NOTE_PATH)?.text).toContain('art: auto');
    expect(api.binaries.get(CACHED)).toEqual(PNG);
  });

  it('leaves a page being typed in alone unless asked: it is pictured once it is saved', async () => {
    const { deps, setProperties, snapshot } = setUp();
    const generate = (asked: boolean) =>
      generateThumbnail({
        deps,
        typeOf: () => book,
        notePath: NOTE_PATH,
        asked,
        unsaved: true,
        setProperties,
      });
    await expect(generate(false)).resolves.toEqual({ kind: 'kept' });
    expect(snapshot.capture).not.toHaveBeenCalled();
    await expect(generate(true)).resolves.toMatchObject({ kind: 'made' });
  });

  it('pictures an artifact whose note is being typed in: its picture is of its copy', async () => {
    const { deps, setProperties } = setUp({ frontmatter: 'type: artifact\n' });
    // Refused by the artifact rule, so it was not stopped for the note's edits.
    await expect(
      generateThumbnail({
        deps,
        typeOf: () => undefined,
        notePath: NOTE_PATH,
        asked: false,
        unsaved: true,
        setProperties,
      }),
    ).rejects.toThrow('There is no saved copy to picture');
  });

  it('refuses a note with no thumbnail property', async () => {
    const { deps, setProperties, snapshot } = setUp();
    await expect(
      generateThumbnail({
        deps,
        typeOf: () => undefined,
        notePath: NOTE_PATH,
        asked: true,
        unsaved: false,
        setProperties,
      }),
    ).rejects.toThrow('This note has no thumbnail property');
    expect(snapshot.capture).not.toHaveBeenCalled();
  });

  it("pictures an artifact's saved copy, as artifacts always were", async () => {
    const { deps, setProperties, snapshot } = setUp({ frontmatter: 'type: artifact\n' });
    // No saved copy: refused by the artifact rule, never pictured as a page.
    await expect(
      generateThumbnail({
        deps,
        typeOf: () => book,
        notePath: NOTE_PATH,
        asked: true,
        unsaved: false,
        setProperties,
      }),
    ).rejects.toThrow('There is no saved copy to picture');
    expect(snapshot.capture).not.toHaveBeenCalled();
  });
});

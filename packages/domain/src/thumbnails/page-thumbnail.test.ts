import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../markdown/editor-node.ts';
import { newPropertyValue, notePropertyKind } from '../page/new-property.ts';
import { parseObjectType, type ObjectType } from '../types/property-def.ts';
import { validatePropertyValue } from '../types/property-value.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  cardFront,
  chosenThumbnail,
  clearedThumbnail,
  isPageThumbnailPath,
  mayPicturePage,
  noteThumbnailKey,
  PAGE_THUMBNAIL_QUIET_MS,
  pageThumbnailPath,
  pageThumbnailRecord,
  pageThumbnailRecordPath,
  pageThumbnailSrc,
  pageThumbnailStale,
  pageThumbnailWait,
  pathHash,
  picturedPageChange,
  readPageThumbnailRecord,
  recordedPicturePath,
  regenerateDiscards,
  thumbnailPropertyOf,
  thumbnailValue,
} from './page-thumbnail.ts';

const BOOK: ObjectType = parseObjectType({
  name: 'book',
  properties: { author: 'text', cover_art: 'thumbnail', spare: 'thumbnail' },
});
const PLAIN: ObjectType = parseObjectType({ name: 'task', properties: { status: 'select' } });
const ARTIFACT: ObjectType = parseObjectType({
  name: 'artifact',
  properties: { cover: 'thumbnail' },
});

const EMPTY: EditorDocument = { type: 'doc', content: [] };
const WITH_IMAGE: EditorDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'sand.png' } }] }],
};

describe('what a thumbnail value means', () => {
  it.each([undefined, null, '', '  ', 'auto', 'AUTO', ' Auto ', 7, true])(
    '%j is a picture of the page',
    (raw) => {
      expect(thumbnailValue(raw)).toEqual({ kind: 'auto' });
    },
  );

  it.each([false, 'false', ' FALSE '])('%j is cleared', (raw) => {
    expect(thumbnailValue(raw)).toEqual({ kind: 'cleared' });
  });

  it('any other text is a picture chosen, trimmed', () => {
    expect(thumbnailValue(' attachments/me.png ')).toEqual({
      kind: 'chosen',
      src: 'attachments/me.png',
    });
  });
});

describe('which property feeds the cover', () => {
  it("is a type's first thumbnail property", () => {
    expect(thumbnailPropertyOf(BOOK)).toBe('cover_art');
  });

  it('is none for a type without one, for no type, and for artifacts', () => {
    expect(thumbnailPropertyOf(PLAIN)).toBeNull();
    expect(thumbnailPropertyOf(undefined)).toBeNull();
    expect(thumbnailPropertyOf(null)).toBeNull();
    expect(thumbnailPropertyOf(ARTIFACT)).toBeNull();
  });

  it("is a note's own `thumbnail` when its type has none", () => {
    expect(noteThumbnailKey({ type: PLAIN, properties: { thumbnail: 'auto' } })).toBe('thumbnail');
    expect(noteThumbnailKey({ type: undefined, properties: { thumbnail: false } })).toBe(
      'thumbnail',
    );
    expect(noteThumbnailKey({ type: PLAIN, properties: {} })).toBeNull();
  });

  it("prefers the type's, and is never an artifact's", () => {
    expect(noteThumbnailKey({ type: BOOK, properties: { thumbnail: 'auto' } })).toBe('cover_art');
    expect(
      noteThumbnailKey({ type: ARTIFACT, properties: { type: 'artifact', thumbnail: 'auto' } }),
    ).toBeNull();
  });
});

describe('what fronts a card', () => {
  it('a chosen picture, then the page, when the type has a thumbnail property', () => {
    expect(
      cardFront({ properties: { cover_art: 'a.png' }, doc: WITH_IMAGE, thumbnailKey: 'cover_art' }),
    ).toEqual({ kind: 'image', src: 'a.png' });
    expect(cardFront({ properties: {}, doc: WITH_IMAGE, thumbnailKey: 'cover_art' })).toEqual({
      kind: 'page',
    });
  });

  it('a cleared one falls back to the cover or first image any card has', () => {
    expect(
      cardFront({ properties: { cover_art: false }, doc: WITH_IMAGE, thumbnailKey: 'cover_art' }),
    ).toEqual({ kind: 'image', src: 'sand.png' });
    expect(
      cardFront({
        properties: { cover_art: false, cover: 'c.png' },
        doc: EMPTY,
        thumbnailKey: 'cover_art',
      }),
    ).toEqual({ kind: 'image', src: 'c.png' });
    expect(
      cardFront({ properties: { cover_art: false }, doc: EMPTY, thumbnailKey: 'cover_art' }),
    ).toEqual({ kind: 'none' });
  });

  it('without a thumbnail property, is what it always was', () => {
    expect(cardFront({ properties: {}, doc: WITH_IMAGE, thumbnailKey: null })).toEqual({
      kind: 'image',
      src: 'sand.png',
    });
    expect(
      cardFront({ properties: { cover_art: 'x.png' }, doc: EMPTY, thumbnailKey: null }),
    ).toEqual({ kind: 'none' });
  });

  it('never fronts a card with a cover that names no picture', () => {
    // An artifact's `cover` is a thumbnail: `auto` and "false" are values it
    // holds, not pictures to load.
    for (const cover of ['auto', 'false', 'FALSE']) {
      expect(cardFront({ properties: { cover }, doc: EMPTY, thumbnailKey: null })).toEqual({
        kind: 'none',
      });
    }
    expect(
      cardFront({ properties: { cover: 'dune.png' }, doc: EMPTY, thumbnailKey: null }),
    ).toEqual({ kind: 'image', src: 'dune.png' });
  });
});

describe('where a page picture is kept', () => {
  it('in the cache, named by a hash of the note path', () => {
    const path = pageThumbnailPath(createVaultPath('Books/Dune.md'));
    expect(path).toMatch(/^\.atlas-cache\/thumbnails\/[0-9a-f]{16}\.png$/);
    expect(pageThumbnailPath(createVaultPath('Books/Dune.md'))).toBe(path);
    expect(pageThumbnailPath(createVaultPath('Books/Emma.md'))).not.toBe(path);
    expect(pageThumbnailSrc(createVaultPath('Books/Dune.md'))).toBe(`/${path}`);
  });

  it('hashes with 64-bit FNV-1a', () => {
    expect(pathHash('')).toBe('cbf29ce484222325');
    expect(pathHash('a')).toBe('af63dc4c8601ec8c');
    expect(pathHash('foobar')).toBe('85944171f73967e8');
  });
});

describe('what a page picture records of the note it was taken from', () => {
  it('is kept beside the picture, and read back', () => {
    const note = createVaultPath('Books/Dune.md');
    expect(pageThumbnailRecordPath(note)).toBe(pageThumbnailPath(note).replace(/\.png$/, '.json'));
    expect(readPageThumbnailRecord(pageThumbnailRecord(1_790_000_000_123))).toBe(1_790_000_000_123);
    expect(recordedPicturePath(pageThumbnailRecordPath(note))).toBe(pageThumbnailPath(note));
    expect(recordedPicturePath(pageThumbnailPath(note))).toBeNull();
    expect(recordedPicturePath(createVaultPath('Books/data.json'))).toBeNull();
  });

  it('reads anything else as no record, so the page is pictured again', () => {
    for (const text of ['', 'nonsense', '{}', '{"from":"soon"}', '{"from":null}', '[1]']) {
      expect(readPageThumbnailRecord(text)).toBeNull();
    }
  });

  it('knows its own pictures from the vault’s files', () => {
    expect(isPageThumbnailPath(pageThumbnailPath(createVaultPath('Books/Dune.md')))).toBe(true);
    expect(isPageThumbnailPath(createVaultPath('artifacts/dune/atlas-thumbnail.png'))).toBe(false);
    expect(isPageThumbnailPath(createVaultPath('.atlas-cache/thumbnails-old/a.png'))).toBe(false);
  });
});

describe('when a page is pictured again', () => {
  it('is stale unless it is a picture of the version the note is now', () => {
    // `picturedAt` is the note's time when it was read to be pictured: a
    // picture of any other version — older, or one the note has since gone
    // back from (a file restored, another note moved onto its path) — is not
    // a picture of this one.
    expect(pageThumbnailStale({ noteModified: 10, picturedAt: null })).toBe(true);
    expect(pageThumbnailStale({ noteModified: 10, picturedAt: 9 })).toBe(true);
    expect(pageThumbnailStale({ noteModified: 10, picturedAt: 10 })).toBe(false);
    expect(pageThumbnailStale({ noteModified: 10, picturedAt: 11 })).toBe(true);
  });

  it('pictures a note dated after now at once, rather than waiting for a clock to catch up', () => {
    const now = 1_000_000;
    expect(pageThumbnailWait({ noteModified: now + 1, picturedAt: 1, now })).toBe(0);
    expect(pageThumbnailWait({ noteModified: now, picturedAt: 1, now })).toBe(
      PAGE_THUMBNAIL_QUIET_MS,
    );
  });

  it('waits for a note that just changed to rest, and not for one with no picture', () => {
    const noteModified = 1_000_000;
    expect(pageThumbnailWait({ noteModified, picturedAt: noteModified, now: 0 })).toBeNull();
    expect(pageThumbnailWait({ noteModified, picturedAt: null, now: noteModified })).toBe(0);
    expect(pageThumbnailWait({ noteModified, picturedAt: 1, now: noteModified + 1_000 })).toBe(
      PAGE_THUMBNAIL_QUIET_MS - 1_000,
    );
    expect(
      pageThumbnailWait({
        noteModified,
        picturedAt: 1,
        now: noteModified + PAGE_THUMBNAIL_QUIET_MS,
      }),
    ).toBe(0);
    expect(pageThumbnailWait({ noteModified, picturedAt: 1, now: noteModified + 60_000 })).toBe(0);
  });
});

describe('what Regenerate, Clear and Choose image… write', () => {
  it('pictures unasked only on auto; asked, whatever it was', () => {
    for (const value of [undefined, 'auto', '']) {
      expect(mayPicturePage({ properties: { t: value }, thumbnailKey: 't', asked: false })).toBe(
        true,
      );
    }
    for (const value of [false, 'me.png']) {
      expect(mayPicturePage({ properties: { t: value }, thumbnailKey: 't', asked: false })).toBe(
        false,
      );
      expect(mayPicturePage({ properties: { t: value }, thumbnailKey: 't', asked: true })).toBe(
        true,
      );
    }
  });

  it('puts a chosen or cleared value back to auto, and leaves auto unwritten', () => {
    const change = picturedPageChange('t');
    expect(change({ t: false })).toEqual({ t: 'auto' });
    expect(change({ t: 'me.png' })).toEqual({ t: 'auto' });
    expect(change({ t: 'auto' })).toEqual({});
    expect(change({})).toEqual({});
  });

  it('clears with false, and chooses with the vault path, from the vault’s top', () => {
    expect(clearedThumbnail('t')).toEqual({ t: false });
    // Unanchored, `Books/attachments/me.png` in `Books/Dune.md` is looked
    // for at `Books/Books/attachments/me.png` first.
    expect(chosenThumbnail('t', createVaultPath('Books/attachments/me.png'))).toEqual({
      t: '/Books/attachments/me.png',
    });
  });
});

describe('what Regenerate would put out of the note', () => {
  const notePath = createVaultPath('Books/Dune.md');
  const discards = (value: unknown) =>
    regenerateDiscards({ properties: { t: value }, thumbnailKey: 't', notePath });

  it('a picture on the web, which only the note remembers', () => {
    expect(discards('https://example.com/dune.jpg')).toBe('https://example.com/dune.jpg');
    expect(discards(' https://example.com/dune.jpg ')).toBe('https://example.com/dune.jpg');
  });

  it('nothing for auto, cleared, or a picture kept in the vault', () => {
    for (const value of [undefined, null, '', 'auto', false, 'false']) {
      expect(discards(value)).toBeNull();
    }
    expect(discards('/Books/attachments/me.png')).toBeNull();
    expect(discards('attachments/me.png')).toBeNull();
  });
});

describe('the thumbnail kind among the others', () => {
  it('is read from a type file, and one the app does not know is still dropped', () => {
    const type = parseObjectType({
      name: 'book',
      properties: { art: { kind: 'thumbnail', label: 'Art' }, odd: 'hologram' },
    });
    expect(type.properties.map(({ key, kind, label }) => ({ key, kind, label }))).toEqual([
      { key: 'art', kind: 'thumbnail', label: 'Art' },
    ]);
  });

  it('holds auto, a path, or false', () => {
    const def = BOOK.properties[1];
    if (def === undefined) throw new Error('the book type has a thumbnail');
    expect(validatePropertyValue({ def, value: 'auto' })).toBeNull();
    expect(validatePropertyValue({ def, value: 'a.png' })).toBeNull();
    expect(validatePropertyValue({ def, value: false })).toBeNull();
    expect(validatePropertyValue({ def, value: true })).toMatch(/must be auto/);
  });

  it('starts as auto on one note, and is known again by its key', () => {
    expect(newPropertyValue('thumbnail')).toBe('auto');
    expect(notePropertyKind('auto', 'thumbnail')).toBe('thumbnail');
    expect(notePropertyKind(false, 'thumbnail')).toBe('thumbnail');
    expect(notePropertyKind('auto', 'note')).toBe('text');
    expect(notePropertyKind(false)).toBe('checkbox');
  });
});

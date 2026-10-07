import { describe, expect, it } from 'vitest';
import { createVaultPath, parseObjectType, pageThumbnailSrc, type WikiLink } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { readBookmark } from './read-bookmark.ts';

/** A body is read as one paragraph holding its text. */
const markdown: MarkdownPort = {
  ...fakeMarkdown(),
  parseBody: (body) => ({
    blocks: [],
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: body.trim() }] }],
    },
  }),
};

const link = (target: string): WikiLink => ({ target, heading: null, alias: null });
const note = (path: string, text: string) => ({ path, text, modified: 1, size: text.length });
const rome = createVaultPath('Trips/Rome.md');
const oslo = createVaultPath('Archive/Trips/Oslo.md');
/** The note the cards are in. */
const plans = createVaultPath('Plans.md');

describe('readBookmark', () => {
  it('reads the linked note: title, description, place and its page picture', async () => {
    const asked: string[][] = [];
    const fs = fakeVaultFs({
      readNotes: async (paths) => {
        asked.push([...paths]);
        return [
          note(rome, '---\ntype: trip\ntitle: Rome in May\ndescription: Ten days.\n---\nBody\n'),
        ];
      },
    });
    const trip = parseObjectType({ name: 'trip', properties: { thumbnail: 'thumbnail' } });
    const card = await readBookmark({
      holder: plans,
      fs,
      markdown,
      link: link('rome'),
      notePaths: [rome, oslo],
      typeOf: (name) => (name === 'trip' ? trip : undefined),
    });
    expect(asked).toEqual([[rome]]);
    expect(card).toEqual({
      kind: 'note',
      path: rome,
      title: 'Rome in May',
      summary: 'Ten days.',
      place: 'Trips',
      archived: false,
      pictures: [pageThumbnailSrc(rome)],
    });
  });

  it('says an archived note is archived', async () => {
    const fs = fakeVaultFs({ readNotes: async () => [note(oslo, 'Cold.\n')] });
    const card = await readBookmark({
      holder: plans,
      fs,
      markdown,
      link: link('Oslo'),
      notePaths: [rome, oslo],
      typeOf: () => undefined,
    });
    expect(card).toMatchObject({
      kind: 'note',
      title: 'Oslo',
      summary: 'Cold.',
      archived: true,
      pictures: [],
    });
  });

  it('is missing when the link names no note, without reading anything', async () => {
    let reads = 0;
    const fs = fakeVaultFs({
      readNotes: async () => {
        reads += 1;
        return [];
      },
    });
    const card = await readBookmark({
      holder: plans,
      fs,
      markdown,
      link: { target: 'Paris', heading: null, alias: 'the Paris trip' },
      notePaths: [rome],
      typeOf: () => undefined,
    });
    expect(card).toEqual({ kind: 'missing', label: 'the Paris trip' });
    expect(reads).toBe(0);
  });

  it('is missing when the note cannot be read', async () => {
    const fs = fakeVaultFs({ readNotes: async () => [] });
    const card = await readBookmark({
      holder: plans,
      fs,
      markdown,
      link: link('Rome'),
      notePaths: [rome],
      typeOf: () => undefined,
    });
    expect(card).toEqual({ kind: 'missing', label: 'Rome' });
  });

  it('passes on a failure of the host, for the card to show', async () => {
    const fs = fakeVaultFs({
      readNotes: async () => {
        throw new Error('host gone');
      },
    });
    await expect(
      readBookmark({
        holder: plans,
        fs,
        markdown,
        link: link('Rome'),
        notePaths: [rome],
        typeOf: () => undefined,
      }),
    ).rejects.toThrow('host gone');
  });
});

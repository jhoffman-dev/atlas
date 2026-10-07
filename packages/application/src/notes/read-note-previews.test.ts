import { describe, expect, it } from 'vitest';
import { parseObjectType, type EditorDocument } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from './ports.ts';
import { PREVIEW_BATCH, readNotePreviews } from './read-note-previews.ts';

/** A body is read as one paragraph holding its text, or an image for `![](src)`. */
const markdown: MarkdownPort = {
  ...fakeMarkdown(),
  parseBody: (body) => {
    const image = /!\[\]\(([^)]+)\)/.exec(body)?.[1];
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        image === undefined
          ? { type: 'paragraph', content: [{ type: 'text', text: body.trim() }] }
          : { type: 'image', attrs: { src: image } },
      ],
    };
    return { blocks: [], doc };
  },
};

const note = (path: string, text: string) => ({ path, text, modified: 1, size: text.length });

describe('readNotePreviews', () => {
  it("fronts a card by its type's thumbnail property first, and says when the note changed", async () => {
    const fs = fakeVaultFs({
      readNotes: async () => [
        { ...note('auto.md', '---\ntype: book\n---\n![](inside.png)\n'), modified: 42 },
        note('chosen.md', '---\ntype: book\nart: me.png\n---\n![](inside.png)\n'),
        note('cleared.md', '---\ntype: book\nart: false\n---\n![](inside.png)\n'),
      ],
    });
    const type = parseObjectType({ name: 'book', properties: { art: 'thumbnail' } });
    const previews = await readNotePreviews({ fs, markdown, paths: ['a', 'b', 'c'], type });
    expect(previews.map(({ front }) => front)).toEqual([
      { kind: 'page' },
      { kind: 'image', src: 'me.png' },
      { kind: 'image', src: 'inside.png' },
    ]);
    expect(previews[0]?.modified).toBe(42);
    // Without the type, the same notes are fronted as they always were.
    const untyped = await readNotePreviews({ fs, markdown, paths: ['a', 'b', 'c'] });
    expect(untyped.map(({ front }) => front.kind)).toEqual(['image', 'image', 'image']);
  });

  it('reads each note’s body as a document, without its frontmatter', async () => {
    const fs = fakeVaultFs({
      readNotes: async () => [note('a.md', '---\ntype: task\n---\nThe body.\n')],
    });
    const [preview] = await readNotePreviews({ fs, markdown, paths: ['a.md'] });
    expect(preview?.path).toBe('a.md');
    expect(preview?.doc.content[0]?.content?.[0]?.text).toBe('The body.');
  });

  it('finds the cover a note names, else the first image in its body', async () => {
    const fs = fakeVaultFs({
      readNotes: async () => [
        note('named.md', '---\ncover: front.png\n---\n![](inside.png)\n'),
        note('inline.md', '![](inside.png)\n'),
        note('plain.md', 'Words only.\n'),
      ],
    });
    const previews = await readNotePreviews({
      fs,
      markdown,
      paths: ['named.md', 'inline.md', 'plain.md'],
    });
    expect(previews.map((preview) => preview.front)).toEqual([
      { kind: 'image', src: 'front.png' },
      { kind: 'image', src: 'inside.png' },
      { kind: 'none' },
    ]);
  });

  it('fronts a note with a thumbnail of its own as any card, in a view whose type has none', async () => {
    // The view draws a plain gallery, which has no picture of a page to show:
    // fronted by its page, the card would lose its cover and show nothing.
    const fs = fakeVaultFs({
      readNotes: async () => [
        note('own.md', '---\ntype: task\nthumbnail: auto\n---\n![](inside.png)\n'),
      ],
    });
    const task = parseObjectType({ name: 'task', properties: { status: 'select' } });
    for (const type of [task, null]) {
      const [preview] = await readNotePreviews({ fs, markdown, paths: ['own.md'], type });
      expect(preview?.front).toEqual({ kind: 'image', src: 'inside.png' });
    }
  });

  it('asks the host once, for at most a batch of notes', async () => {
    const asked: (readonly string[])[] = [];
    const fs = fakeVaultFs({
      readNotes: async (paths) => {
        asked.push(paths);
        return [];
      },
    });
    const paths = Array.from({ length: PREVIEW_BATCH + 5 }, (_, at) => `${at}.md`);
    await readNotePreviews({ fs, markdown, paths });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(paths.slice(0, PREVIEW_BATCH));
  });

  it('leaves out a note the host could not read rather than failing the rest', async () => {
    const fs = fakeVaultFs({ readNotes: async () => [note('b.md', 'Still here.')] });
    const previews = await readNotePreviews({ fs, markdown, paths: ['gone.md', 'b.md'] });
    expect(previews.map((preview) => preview.path)).toEqual(['b.md']);
  });

  it('passes on a host that fails outright', async () => {
    const fs = fakeVaultFs({
      readNotes: async () => {
        throw new Error('no vault open');
      },
    });
    await expect(readNotePreviews({ fs, markdown, paths: ['a.md'] })).rejects.toThrow(
      'no vault open',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  BLOCK_ID_ATTR,
  paragraphOfBookmark,
  paragraphWithBookmark,
  type EditorDocument,
  type EditorNode,
} from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * A bookmark in the file is its link alone in a paragraph, then a comment
 * every markdown reader hides (ADR-0020): Obsidian shows a working link, and
 * Atlas shows a card. It is read as a bookmark only with the marker, kept
 * byte for byte when untouched, and written so it reads back as itself.
 */
const MARKER = '<!-- atlas:bookmark -->';

const blocks = (markdown: string) => parseMarkdownBody(markdown).doc.content;

/** The body saved after `edit` has changed its document's blocks. */
function saveAfter(markdown: string, edit: (content: EditorNode[]) => EditorNode[]): string {
  const parsed = parseMarkdownBody(markdown);
  const doc: EditorDocument = { type: 'doc', content: edit([...parsed.doc.content]) };
  return serializeMarkdownBody({ originalBody: markdown, parsed, doc });
}

const withoutId = ({ attrs, ...node }: EditorNode): EditorNode => {
  const rest = Object.fromEntries(
    Object.entries(attrs ?? {}).filter(([key]) => key !== BLOCK_ID_ATTR),
  );
  return Object.keys(rest).length === 0 ? node : { ...node, attrs: rest };
};

describe('reading a bookmark', () => {
  it.each([
    ['the marker as Atlas writes it', `[[Trip plan]] ${MARKER}`],
    ['no space before the marker', `[[Trip plan]]${MARKER}`],
    ['spacing inside the comment', '[[Trip plan]] <!--atlas:bookmark-->'],
    ['spaces after it', `[[Trip plan]] ${MARKER}   `],
  ])('reads %s as a bookmark', (_label, line) => {
    expect(blocks(`${line}\n`).map(withoutId)).toEqual([
      { type: 'bookmark', attrs: { target: 'Trip plan', heading: null, alias: null } },
    ]);
  });

  it('keeps a heading and an alias', () => {
    expect(blocks(`[[Trip plan#Days|the days]] ${MARKER}\n`).map(withoutId)).toEqual([
      { type: 'bookmark', attrs: { target: 'Trip plan', heading: '#Days', alias: 'the days' } },
    ]);
  });

  it('does not make a bookmark of a link alone on its line', () => {
    expect(blocks('[[Trip plan]]\n').map((node) => node.type)).toEqual(['paragraph']);
  });

  it.each([
    ['another comment', '[[Trip plan]] <!-- todo -->'],
    ['words before the link', `See [[Trip plan]] ${MARKER}`],
    ['words after the marker', `[[Trip plan]] ${MARKER} and more`],
    ['two links', `[[Trip]] [[Plan]] ${MARKER}`],
    ['an embed', `![[Trip plan]] ${MARKER}`],
    ['a web link', `[Trip](https://example.com) ${MARKER}`],
    ['the marker first', `${MARKER} [[Trip plan]]`],
    // Read from the line, so each of these must still fail as a whole (A22-01).
    ['an escaped link', `\\[[Trip plan]] ${MARKER}`],
    ['brackets after the link', `[[Trip]] b]] ${MARKER}`],
  ])('is not fooled by %s, which is kept as written', (_label, line) => {
    const body = `${line}\n`;
    expect(blocks(body).some((node) => node.type === 'bookmark')).toBe(false);
    expect(saveAfter(body, (content) => content)).toBe(body);
  });

  // A link is one token (A21-03), so a comment cannot start inside it and
  // swallow the marker: this is a card of the note named `Trip <!-- plan`.
  it('reads a link whose name holds a comment opener as one link, before its marker', () => {
    expect(blocks(`[[Trip <!-- plan]] ${MARKER}\n`).map(withoutId)).toEqual([
      { type: 'bookmark', attrs: { target: 'Trip <!-- plan', heading: null, alias: null } },
    ]);
  });

  it('does not read one inside a list', () => {
    expect(blocks(`- [[Trip plan]] ${MARKER}\n`).map((node) => node.type)).not.toContain(
      'bookmark',
    );
  });
});

describe('saving around a bookmark', () => {
  const note = [
    '# Plans',
    '',
    `[[Trip plan]]   <!--atlas:bookmark-->`,
    '',
    'Packing list',
    '',
  ].join('\n');

  it('keeps an untouched bookmark byte for byte, spacing and all, when the note is saved', () => {
    expect(saveAfter(note, (content) => content)).toBe(note);
  });

  it('keeps it when the paragraph after it is edited', () => {
    const saved = saveAfter(note, (content) => {
      const packing = content[2]!;
      content[2] = { ...packing, content: [{ type: 'text', text: 'Packing list, done' }] };
      return content;
    });
    expect(saved).toBe(note.replace('Packing list', 'Packing list, done'));
  });

  it('keeps it when a block is typed straight before it', () => {
    const saved = saveAfter(note, (content) => [
      content[0]!,
      { type: 'paragraph', content: [{ type: 'text', text: 'Next:' }] },
      ...content.slice(1),
    ]);
    expect(saved).toContain(`Next:\n\n[[Trip plan]]   <!--atlas:bookmark-->\n\nPacking list`);
  });

  it('keeps it when it is dragged below the paragraph after it', () => {
    const saved = saveAfter(note, (content) => [content[0]!, content[2]!, content[1]!]);
    expect(saved).toBe('# Plans\n\nPacking list\n\n[[Trip plan]]   <!--atlas:bookmark-->\n');
  });

  it('writes a new bookmark with the marker, reading back as the same bookmark', () => {
    const saved = saveAfter('# Plans\n', (content) => [
      ...content,
      { type: 'bookmark', attrs: { target: 'Trip plan', heading: '#Days', alias: 'days' } },
    ]);
    expect(saved).toBe(`# Plans\n\n[[Trip plan#Days|days]] ${MARKER}\n`);
    expect(blocks(saved).map(withoutId)[1]).toEqual({
      type: 'bookmark',
      attrs: { target: 'Trip plan', heading: '#Days', alias: 'days' },
    });
  });

  it('writes a target remark would escape as it is', () => {
    const saved = saveAfter('', () => [
      { type: 'bookmark', attrs: { target: '*Trip* _plan_ #1', heading: null, alias: null } },
    ]);
    expect(saved).toBe(`[[*Trip* _plan_ #1]] ${MARKER}\n`);
  });

  it('writes a bookmark changed to another note afresh, and nothing else', () => {
    const saved = saveAfter(note, (content) => {
      content[1] = { ...content[1]!, attrs: { ...content[1]!.attrs, target: 'Other' } };
      return content;
    });
    expect(saved).toBe(`# Plans\n\n[[Other]] ${MARKER}\n\nPacking list\n`);
  });
});

describe('switching a link between a link and a bookmark', () => {
  const note = '# Plans\n\nSee [[Trip plan]] for the days.\n\nPacking list\n';

  const switchToBookmark = (markdown: string) =>
    saveAfter(markdown, (content) => {
      const at = content.findIndex((node) =>
        (node.content ?? []).some((child) => child.type === 'wikiLink'),
      );
      const paragraph = content[at]!;
      const index = paragraph.content!.findIndex((child) => child.type === 'wikiLink');
      content.splice(at, 1, ...paragraphWithBookmark(paragraph, index)!);
      return content;
    });

  it('splits the sentence around the card, and leaves the blocks around it alone', () => {
    expect(switchToBookmark(note)).toBe(
      `# Plans\n\nSee\n\n[[Trip plan]] ${MARKER}\n\nfor the days.\n\nPacking list\n`,
    );
  });

  it('turns a link alone in its paragraph into a bookmark and back, to the same bytes', () => {
    const plain = '# Plans\n\n[[Trip plan]]\n\nPacking list\n';
    const marked = switchToBookmark(plain);
    expect(marked).toBe(`# Plans\n\n[[Trip plan]] ${MARKER}\n\nPacking list\n`);

    const back = saveAfter(marked, (content) => {
      content[1] = paragraphOfBookmark(content[1]!)!;
      return content;
    });
    expect(back).toBe(plain);
  });

  it('keeps the other blocks byte for byte, odd spacing included', () => {
    // The gap before a rewritten block is a blank line, as for any edit.
    const odd = '#   Plans  \n\n\n[[Trip plan]]\n\n*  Packing\n';
    expect(switchToBookmark(odd)).toBe(`#   Plans  \n\n[[Trip plan]] ${MARKER}\n\n*  Packing\n`);
  });
});

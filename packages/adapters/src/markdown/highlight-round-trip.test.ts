import { describe, expect, it } from 'vitest';
import {
  anchoredBlocks,
  appendHighlights,
  locateFragment,
  literatureNoteText,
  splitFrontmatter,
  withHighlightComment,
  type EditorDocument,
} from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';

/**
 * A literature note's highlights (#503, ADR-0043) as the editor, the index and a
 * save read them: kept byte for byte when untouched or when another block is
 * edited, the hidden marker out of the words searched, and the `^id` naming
 * the whole quote, so `[[Source#^id]]` and `![[Source#^id]]` find it.
 */

/** A fixed random source: the same ids on every run. */
function drawn(): () => number {
  let at = 0;
  return () => ((at++ * 7) % 36) / 36;
}

const NOTE = appendHighlights({
  text: `${literatureNoteText({ kind: 'epub', title: 'Moby Dick', author: 'Herman Melville', file: null })}# Moby Dick\n\nMy own paragraph.\n`,
  highlights: [
    {
      quote: 'Call me Ishmael. Some years ago — never mind how long precisely —',
      anchor: {
        kind: 'epub',
        cfi: 'epubcfi(/6/8!/4/2/1:0)',
        quote: { exact: 'Call me Ishmael.', prefix: '', suffix: ' Some years' },
      },
      comment: 'The **first** line. See [[Whaling]].',
    },
    {
      quote: 'It is a way I have of driving off the spleen, and *regulating* the circulation.',
      anchor: { kind: 'kindle', location: { start: 77, end: 79 }, annotationId: null },
    },
  ],
  random: drawn(),
});

const body = splitFrontmatter(NOTE.text).body;
const [first, second] = NOTE.highlights.map((highlight) => highlight.id);

const save = (markdown: string, doc: EditorDocument) =>
  remarkMarkdown.serializeBody({
    originalBody: markdown,
    parsed: remarkMarkdown.parseBody(markdown),
    doc,
  });

describe('a literature note in the editor and the index', () => {
  it('saves an untouched note byte for byte', () => {
    const parsed = remarkMarkdown.parseBody(body);
    expect(save(body, parsed.doc)).toBe(body);
  });

  it("keeps each highlight's bytes when another block is edited", () => {
    const parsed = remarkMarkdown.parseBody(body);
    const content = parsed.doc.content.map((node) =>
      node.type === 'paragraph'
        ? { ...node, content: [{ type: 'text', text: 'Edited in DFAI.' }] }
        : node,
    );
    const saved = save(body, { type: 'doc', content });
    expect(saved).toBe(body.replace('My own paragraph.', 'Edited in DFAI.'));
  });

  it("keeps a comment edited by DFAI's writer, read back by the editor, as written", () => {
    const edited = withHighlightComment({
      text: NOTE.text,
      id: first as string,
      comment: 'Changed.',
    });
    const editedBody = splitFrontmatter(edited).body;
    expect(save(editedBody, remarkMarkdown.parseBody(editedBody).doc)).toBe(editedBody);
  });

  it('names each whole highlight by its id, so a link or an embed finds it', () => {
    const { doc } = remarkMarkdown.parseBody(body);
    expect(anchoredBlocks(doc).map((block) => block.id)).toEqual([first, second]);
    const at = locateFragment(doc, { kind: 'block', id: second as string });
    expect(at).not.toBeNull();
    const node = doc.content[at?.[0] as number];
    expect(JSON.stringify(node)).toContain('regulating');
  });

  it('searches the quote and the comment, never the marker', () => {
    const words = remarkMarkdown.plainText(body);
    expect(words).toContain('Call me Ishmael');
    expect(words).toContain('first');
    expect(words).not.toContain('atlas:highlight');
    expect(words).not.toContain('epubcfi');
  });

  it('reads the frontmatter it wrote as a literature note', () => {
    expect(
      remarkMarkdown.frontmatterProperties(splitFrontmatter(NOTE.text).frontmatter),
    ).toMatchObject({
      type: 'literature',
      kind: 'epub',
      title: 'Moby Dick',
      author: 'Herman Melville',
    });
  });
});

/**
 * Adversarial pass on tags through the real markdown adapter (P20-02, P20-05):
 * what the editor draws as a tag, the serializer writes and the index reads
 * must be the same tag, and a rename must change only the bytes it renames.
 */
import { describe, expect, it } from 'vitest';
import { renameTagInNote } from '@atlas/application';
import {
  findTags,
  noteTags,
  splitFrontmatter,
  tagRenameProblem,
  TAGS_KEY,
  type EditorDocument,
} from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/** The tags the index reads in a note, by name, in order. */
const indexedTags = (text: string) => {
  const document = splitFrontmatter(text);
  return noteTags({
    tagsProperty: remarkMarkdown.frontmatterProperties(document.frontmatter)[TAGS_KEY],
    body: document.body,
    ranges: remarkMarkdown.textRanges(document.body),
  }).map((tag) => tag.name);
};

/** A paragraph typed into the editor as plain text, saved. */
const saveTyped = (text: string) => {
  const doc: EditorDocument = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
  return serializeMarkdownBody({ originalBody: '', parsed: parseMarkdownBody(''), doc });
};

describe('a word whose name starts and ends with _', () => {
  // Decided (A20-03): a tag's name may not start or end with `_`, since
  // markdown reads `_x_` as emphasis. Editor, serializer and index must then
  // agree it is no tag, and the text must come back as it was typed.
  it.each([['#_private_ note'], ['#__init__ note']])(
    'typed as %s, is no tag, before or after saving',
    (typed) => {
      expect(findTags(typed)).toEqual([]);
      const saved = saveTyped(typed);
      expect(indexedTags(saved)).toEqual([]);
    },
  );

  it.each([['#_private_ note'], ['#__init__ note'], ['#draft_ and _more_']])(
    'typed in the editor as %s, comes back as the text that was typed, with no emphasis',
    (typed) => {
      const saved = saveTyped(typed);
      expect(parseMarkdownBody(saved).doc.content[0]?.content).toEqual([
        { type: 'text', text: typed },
      ]);
    },
  );

  it('ending a tag, is left out of it: #draft_ is the tag draft, read the same after saving', () => {
    const saved = saveTyped('#draft_ note');
    expect(findTags('#draft_ note').map((tag) => tag.name)).toEqual(['draft']);
    expect(indexedTags(saved)).toEqual(['draft']);
  });

  it('is refused as a new name, so no rename writes a tag that would not read back', () => {
    expect(tagRenameProblem({ from: 'idea', to: '_draft_' })).toMatch(/start or end with _/);
  });
});

describe('renaming a tag in a block-style tags list', () => {
  it('changes only the renamed item’s bytes', () => {
    const text = '---\ntags:\n- idea\n- other\n---\nBody.\n';
    const renamed = renameTagInNote({
      text,
      markdown: remarkMarkdown,
      rename: { from: 'idea', to: 'thought' },
    });
    expect(renamed.text).toBe('---\ntags:\n- thought\n- other\n---\nBody.\n');
  });

  it('keeps an indented list indented', () => {
    const renamed = renameTagInNote({
      text: '---\ntags:\n    - idea\n    - "other"\n---\nBody.\n',
      markdown: remarkMarkdown,
      rename: { from: 'idea', to: 'thought' },
    });
    expect(renamed.text).toBe('---\ntags:\n    - thought\n    - "other"\n---\nBody.\n');
  });
});

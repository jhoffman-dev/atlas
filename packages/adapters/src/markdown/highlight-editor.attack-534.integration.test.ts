import { describe, expect, it } from 'vitest';
import { literatureHighlightReader } from '@dfai/application';
import {
  appendHighlights,
  BLOCK_ANCHOR_ATTR,
  literatureNoteText,
  readHighlights,
  splitFrontmatter,
  withHighlightComment,
  type VaultPath,
} from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';
import { noteBlocks } from './note-blocks.ts';

/*
 * Attack on PR #534 (#523): the comment field shows `HighlightView.comment`,
 * the comment's markdown as the file holds it, escapes and all. A person who
 * types `%%` in the field (an unbalanced one, which the write escapes so the
 * rest of the note is not hidden) then sees `%\%` in it — words they never
 * typed — and an embed shows them too.
 */

/** A fixed random source: the same ids on every run. */
function drawn(): () => number {
  let at = 0;
  return () => ((at++ * 7 + 3) % 36) / 36;
}

const TEXT = appendHighlights({
  text: `${literatureNoteText({ kind: 'pdf', title: 'The Lantern Keepers', author: 'Mara Quill', file: 'Library/The Lantern Keepers.pdf' as VaultPath })}# The Lantern Keepers\n\nMy own paragraph.\n`,
  highlights: [
    {
      quote: 'The last lamp.',
      anchor: {
        kind: 'pdf',
        page: 3,
        quote: { exact: 'The last lamp.', prefix: '', suffix: '' },
        rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.02 }],
      },
    },
  ],
  random: drawn(),
  noteBlocks,
}).text;

/** The comment the field shows for highlight `id` of `text`, as the editor draws it. */
function fieldShows(text: string, id: string): string | null {
  const { frontmatter, body } = splitFrontmatter(text);
  const properties = remarkMarkdown.frontmatterProperties(frontmatter);
  const reader = literatureHighlightReader(remarkMarkdown, { properties, text });
  const node = remarkMarkdown
    .parseBody(body)
    .doc.content.find((each) => each.attrs?.[BLOCK_ANCHOR_ATTR] === id);
  return reader?.({ markdown: String(node?.attrs?.['markdown'] ?? ''), id })?.comment ?? null;
}

describe('a comment typed with an unbalanced `%%`', () => {
  const id = readHighlights(TEXT, noteBlocks)[0]?.id ?? '';
  const typed = 'Half of it, 50%% sure.';
  const written = withHighlightComment({ text: TEXT, id, comment: typed, noteBlocks });

  it('is written escaped, so the rest of the note stays shown (the premise)', () => {
    expect(written).toContain('50%\\% sure.');
  });

  it('reads back in its field as the person typed it', () => {
    expect(fieldShows(written, id)).toBe(typed);
  });
});

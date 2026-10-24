import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '@dfai/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/*
 * Coordinator decision on PR #534: a numbered list made across a hidden
 * tombstone is split around it (the tombstone is lifted back to the top
 * level), and the editor numbers the second half on from the first
 * (`start`). What the note says on disk is the point: "2." after "1.", not
 * two lists that each begin at "1.".
 */
const TOMBSTONE =
  '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","location":9,"annotationId":"A9","words":"3f2a"} -->';
const ORIGINAL = `Above.\n\n${TOMBSTONE}\n\nBelow.\n`;

const numbered = (start: number, paragraph: EditorNode): EditorNode => ({
  type: 'orderedList',
  attrs: { start },
  content: [{ type: 'listItem', content: [paragraph] }],
});

describe('a numbered list split around a hidden tombstone, as saved', () => {
  it('numbers the second half on from the first', () => {
    const parsed = parseMarkdownBody(ORIGINAL);
    const [above, tombstone, below] = parsed.doc.content;
    if (above === undefined || tombstone === undefined || below === undefined) {
      throw new Error('the note reads as three blocks');
    }
    expect(tombstone.type).toBe('rawBlock');
    // As the editor leaves it once the list is made across the tombstone.
    const doc: EditorDocument = {
      type: 'doc',
      content: [numbered(1, above), tombstone, numbered(2, below)],
    };
    const saved = serializeMarkdownBody({ originalBody: ORIGINAL, parsed, doc });
    expect(saved).toMatch(/^1\. Above\.$/m);
    expect(saved).toContain(TOMBSTONE);
    expect(saved).toMatch(/^2\. Below\.$/m);
    expect(saved.indexOf(TOMBSTONE)).toBeLessThan(saved.indexOf('2. Below.'));
  });
});

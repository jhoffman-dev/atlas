import { describe, expect, it } from 'vitest';
import type { EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * Adversarial probes of Phase 22's bookmarks against the writer's promise
 * (A21-01, ADR-0020): whatever the editor holds is saved so that it reads
 * back as that same document — and a link is never lost on the way.
 */

const bookmark = (target: string): EditorNode => ({
  type: 'bookmark',
  attrs: { target, heading: null, alias: null },
});
const paragraph = (text: string): EditorNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

/** A new note holding `content`, saved, then read back. */
function saveAndReload(...content: EditorNode[]) {
  const markdown = serializeMarkdownBody({
    originalBody: '',
    parsed: parseMarkdownBody(''),
    doc: { type: 'doc', content },
  });
  return { markdown, blocks: parseMarkdownBody(markdown).doc.content };
}

const types = (nodes: readonly EditorNode[]): string[] =>
  nodes.flatMap((node) => [node.type, ...types(node.content ?? [])]);

describe('a bookmark the editor holds inside another block', () => {
  // The editor's schema lets a bookmark (group `block`) sit in a table cell,
  // a quote, a callout or a list item — by drag, or by paste.
  it('keeps the link when the bookmark is in a table cell', () => {
    const table: EditorNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('Trip')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [bookmark('Rome')] }] },
      ],
    };
    const { markdown } = saveAndReload(table);
    expect(markdown).toContain('[[Rome]]');
  });

  it.each([
    ['a quote', { type: 'blockquote', content: [bookmark('Rome')] }],
    [
      'a callout',
      {
        type: 'callout',
        attrs: { kind: 'note', title: null, fold: null },
        content: [bookmark('Rome')],
      },
    ],
    [
      'a list item',
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph('one'), bookmark('Rome')] }],
      },
    ],
  ] as const)('reads back as the editor held it when the bookmark is in %s', (_where, block) => {
    const { blocks } = saveAndReload(block as EditorNode);
    expect(types(blocks)).not.toContain('rawBlock');
  });
});

describe('a bookmark to a note whose name markdown reads as markup', () => {
  // `_`, `*` and `~` are legal in a note name (linkBreakingCharacter allows them).
  it.each(['_draft_', 'a*b*c', '~~old~~', 'a<b>'])(
    'reads a bookmark to "%s" back as a bookmark to it',
    (target) => {
      const { blocks } = saveAndReload(bookmark(target));
      expect(blocks.map((node) => [node.type, node.attrs?.['target']])).toEqual([
        ['bookmark', target],
      ]);
    },
  );
});

import { Node } from '@tiptap/core';
import { calloutLabel } from '@atlas/domain';

/**
 * An Obsidian callout. The marker line is held in attributes and drawn as a
 * non-editable header, so the body can be edited freely without the risk of
 * breaking the `[!note]` that makes it a callout.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: { default: 'note' },
      title: { default: null },
      fold: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node }) {
    const kind = String(node.attrs['kind'] ?? 'note');
    return [
      'div',
      { class: 'callout', 'data-callout': kind },
      [
        'div',
        { class: 'callout__title', contenteditable: 'false' },
        calloutLabel({
          kind,
          title: (node.attrs['title'] as string | null) ?? null,
          fold: (node.attrs['fold'] as string | null) ?? null,
        }),
      ],
      ['div', { class: 'callout__body' }, 0],
    ];
  },
});

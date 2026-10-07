import { Node } from '@tiptap/core';

/**
 * A block of markdown the editor does not model — a table, an image, raw HTML.
 * It is an atom: shown as its source and carried through a save untouched, so an
 * unsupported construct is never approximated and quietly rewritten.
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      markdown: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'pre[data-raw-block]' }];
  },

  renderHTML({ node }) {
    return [
      'pre',
      { 'data-raw-block': '', class: 'raw-block', title: 'Not editable yet — saved unchanged' },
      String(node.attrs['markdown'] ?? ''),
    ];
  },
});

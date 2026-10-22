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
    const markdown = String(node.attrs['markdown'] ?? '');
    return [
      'pre',
      {
        'data-raw-block': '',
        class: isComment(markdown) ? 'raw-block raw-block--comment' : 'raw-block',
        title: 'Not editable yet — saved unchanged',
      },
      markdown,
    ];
  },
});

/**
 * Whether a raw block is one HTML comment and nothing else — a marker DFAI
 * writes around a meeting's summary (#186), say — which nobody reads: it is
 * drawn small and muted rather than as a block of source.
 */
const isComment = (markdown: string): boolean =>
  /^<!--(?:(?!-->)[\s\S])*-->$/.test(markdown.trim());

import { mergeAttributes, Node } from '@tiptap/core';
import { wikiLinkLabel } from '@atlas/domain';
import { linkAttributes } from './link-attributes.ts';

/**
 * `[[Another Note]]` as a single inline atom: it is selected and deleted as one
 * thing, and its brackets cannot be half-edited into something that no longer parses.
 */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      ...linkAttributes('data-wikilink'),
      // `![[…]]`: written back with its `!`, which as text would be escaped.
      embed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-embed') === 'true',
        renderHTML: (attrs) => (attrs['embed'] === true ? { 'data-embed': 'true' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'wikilink',
        // No href: following it is the app's job, not the webview's.
        role: 'link',
        tabindex: '0',
      }),
      wikiLinkLabel({
        target: String(node.attrs['target'] ?? ''),
        heading: (node.attrs['heading'] as string | null) ?? null,
        alias: (node.attrs['alias'] as string | null) ?? null,
      }),
    ];
  },
});

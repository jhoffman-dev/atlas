import { Extension } from '@tiptap/core';

/** Every top-level block type that can carry a source identity. */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'callout',
  'codeBlock',
  'horizontalRule',
  'table',
  'rawBlock',
  'bookmark',
  'blockEmbed',
  'queryBlock',
] as const;

/**
 * Carries each block's origin through editing. A block that still has its id and
 * still serializes the same way is written back with its original bytes; a block
 * the user created has no id, so it is written fresh.
 */
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_TYPES],
        attributes: {
          blockId: { default: null, rendered: false, keepOnSplit: false },
        },
      },
    ];
  },
});

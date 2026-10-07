import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const revealedBlock = new PluginKey<DecorationSet>('revealedBlock');

/** The block to mark, by where it starts in the document, or null to mark none. */
type Revealed = { readonly at: number } | null;

/**
 * Marks the block a followed `[[Note#^id]]` pointed at (P26-03), for a moment,
 * so the eye finds it. A decoration rather than a class set on the block's
 * element: ProseMirror redraws a block whose attributes change underneath it.
 */
export const RevealedBlock = Extension.create({
  name: 'revealedBlock',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: revealedBlock,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, marked) => {
            const asked = tr.getMeta(revealedBlock) as Revealed | undefined;
            if (asked === undefined) return marked.map(tr.mapping, tr.doc);
            const node = asked === null ? null : tr.doc.nodeAt(asked.at);
            if (asked === null || node === null) return DecorationSet.empty;
            const mark = Decoration.node(asked.at, asked.at + node.nodeSize, {
              class: 'is-revealed',
            });
            return DecorationSet.create(tr.doc, [mark]);
          },
        },
        props: { decorations: (state) => revealedBlock.getState(state) ?? null },
      }),
    ];
  },
});

/** Marks the block starting at `at`, or none with null. */
export function markRevealed(editor: Editor, at: number | null): void {
  const revealed: Revealed = at === null ? null : { at };
  editor.view.dispatch(
    editor.state.tr.setMeta(revealedBlock, revealed).setMeta('addToHistory', false),
  );
}

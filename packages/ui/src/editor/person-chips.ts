import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { PersonChip } from '@atlas/domain';

/** The chip for a link's target when it opens a person, or null. */
export type PersonFor = (target: string) => PersonChip | null;

export interface PersonChipsOptions {
  personFor: PersonFor;
}

const key = new PluginKey<DecorationSet>('personChips');

/** The chip decoration for each `[[link]]` that opens a person, from `from` to `to`. */
function chipsBetween(
  doc: ProseMirrorNode,
  { from, to, personFor }: { from: number; to: number; personFor: PersonFor },
): Decoration[] {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name !== 'wikiLink' || node.attrs['embed'] === true) return true;
    const chip = personFor(String(node.attrs['target'] ?? ''));
    if (chip !== null) {
      decorations.push(
        Decoration.node(position, position + node.nodeSize, {
          // Added to the link's own `wikilink` class.
          class: 'wikilink--person',
          'data-initial': chip.initial,
        }),
      );
    }
    return false;
  });
  return decorations;
}

function chipDecorations(doc: ProseMirrorNode, personFor: PersonFor): DecorationSet {
  return DecorationSet.create(doc, chipsBetween(doc, { from: 0, to: doc.content.size, personFor }));
}

/** The ranges of the new document a transaction wrote, in its coordinates. */
function changedRanges(transaction: Transaction): { from: number; to: number }[] {
  let ranges: { from: number; to: number }[] = [];
  for (const map of transaction.mapping.maps) {
    ranges = ranges.map(({ from, to }) => ({ from: map.map(from, -1), to: map.map(to, 1) }));
    map.forEach((_oldFrom, _oldTo, from, to) => ranges.push({ from, to }));
  }
  return ranges;
}

/**
 * The chips after an edit: those drawn before, moved with the text, and
 * looked up again only where the edit wrote — typing in a long note asks
 * about the links beside the caret, not every link in it.
 */
function chipsAfter(
  transaction: Transaction,
  { previous, personFor }: { previous: DecorationSet; personFor: PersonFor },
): DecorationSet {
  const { doc } = transaction;
  let chips = previous.map(transaction.mapping, doc);
  for (const range of changedRanges(transaction)) {
    // A step beside a link (deleting the space after it) touches it too.
    const from = Math.max(0, range.from - 1);
    const to = Math.min(doc.content.size, range.to + 1);
    chips = chips.remove(chips.find(from, to)).add(doc, chipsBetween(doc, { from, to, personFor }));
  }
  return chips;
}

/**
 * Draws a link to a person as a chip — their initial in a circle beside their
 * name — while it stays an ordinary `[[Name]]` in the document and the file.
 *
 * Worked out from the links and the vault's people, as tags are from the
 * text, so the note holds nothing Obsidian would not read. The people change
 * as the vault does: {@link redrawPersonChips} asks for the chips again.
 */
export const PersonChips = Extension.create<PersonChipsOptions>({
  name: 'personChips',

  addOptions() {
    return { personFor: () => null };
  },

  addProseMirrorPlugins() {
    const { personFor } = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => chipDecorations(state.doc, personFor),
          apply: (transaction, previous) => {
            if (transaction.getMeta(key) === true)
              return chipDecorations(transaction.doc, personFor);
            return transaction.docChanged
              ? chipsAfter(transaction, { previous, personFor })
              : previous;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});

/** Draws the chips again, after the vault's people changed. */
export function redrawPersonChips(editor: Editor): void {
  if (editor.isDestroyed) return;
  // Nothing in the note changed: not an edit to save, nor a step to undo.
  editor.view.dispatch(
    editor.state.tr
      .setMeta(key, true)
      .setMeta('preventUpdate', true)
      .setMeta('addToHistory', false),
  );
}

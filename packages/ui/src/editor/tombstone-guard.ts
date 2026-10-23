import { Extension } from '@tiptap/core';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { isTombstoneBlock } from '@dfai/domain';
import { READ_FROM_FILE } from './block-anchor.ts';

/*
 * A removed Kindle highlight's tombstone is hidden (ADR-0043 §5) but is still
 * an atom of the document, and the next sync reads it to know the passage was
 * removed: lose it and the removed highlight comes back (#534). The person
 * cannot see it, so nothing they do next to it may take it. A step that drops
 * it — Backspace or Delete beside it, a selection across it deleted, cut or
 * pasted over — is let happen for everything the person can see, and the
 * tombstone is put back, after the block the deletion joined, in the same
 * undo step. Only a note read from its file (the highlight was removed on the
 * person's word) takes one away.
 */

const isTombstone = (node: ProseMirrorNode): boolean =>
  node.type.name === 'rawBlock' && isTombstoneBlock(String(node.attrs['markdown'] ?? ''));

interface Held {
  readonly node: ProseMirrorNode;
  readonly pos: number;
}

function tombstonesIn(doc: ProseMirrorNode): Held[] {
  const held: Held[] = [];
  doc.forEach((node, pos) => {
    if (isTombstone(node)) held.push({ node, pos });
  });
  return held;
}

/** The tombstones the transactions took, put back at the block boundary nearest where they were. */
function restoration(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  if (!transactions.some((transaction) => transaction.docChanged)) return null;
  if (transactions.some((transaction) => transaction.getMeta(READ_FROM_FILE) === true)) return null;
  const before = tombstonesIn(oldState.doc);
  if (before.length === 0) return null;
  const remaining = new Map<string, number>();
  for (const { node } of tombstonesIn(newState.doc)) {
    const key = String(node.attrs['markdown']);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const lost = before.filter(({ node }) => {
    const key = String(node.attrs['markdown']);
    const left = remaining.get(key) ?? 0;
    remaining.set(key, Math.max(0, left - 1));
    return left === 0;
  });
  if (lost.length === 0) return null;
  const mapping = new Mapping();
  for (const transaction of transactions) mapping.appendMapping(transaction.mapping);
  // Boundaries are found in the document as it is, then inserted last to first so none shifts another.
  const putBack = lost
    .map(({ node, pos }) => ({ node, at: blockBoundary(newState.doc, mapping.map(pos, -1)) }))
    .sort((one, other) => other.at - one.at);
  const tr = newState.tr;
  for (const { node, at } of putBack) tr.insert(at, node);
  return tr;
}

/** `pos` if it is between top-level blocks, else the end of the top-level block it is in. */
function blockBoundary(doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  return $pos.depth === 0 ? $pos.pos : $pos.after(1);
}

/**
 * Backspace at the start of a block, or Delete at its end, with only hidden
 * tombstones between it and the next block: joins the two blocks across them
 * (the tombstone is put back after) rather than selecting what is not drawn.
 * Answers false where this is not the case, so the key does what it always does.
 */
function joinAcross(view: EditorView, direction: -1 | 1): boolean {
  const { selection, doc } = view.state;
  if (!selection.empty) return false;
  const $head = selection.$head;
  if ($head.depth !== 1 || !$head.parent.isTextblock) return false;
  const atEdge =
    direction < 0 ? $head.parentOffset === 0 : $head.parentOffset === $head.parent.content.size;
  if (!atEdge) return false;
  let index = $head.index(0) + direction;
  if (doc.maybeChild(index) === null || !isTombstone(doc.child(index))) return false;
  while (doc.maybeChild(index) !== null && isTombstone(doc.child(index))) index += direction;
  const other = doc.maybeChild(index);
  // Nothing to join to: the key does nothing rather than reach for what it cannot see.
  if (other === null || !other.isTextblock) return true;
  let otherStart = 0;
  for (let at = 0; at < index; at += 1) otherStart += doc.child(at).nodeSize;
  const joined =
    direction < 0
      ? { from: otherStart + other.nodeSize - 1, to: $head.pos }
      : { from: $head.pos, to: otherStart + 1 };
  const tr = view.state.tr.delete(joined.from, joined.to);
  view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(joined.from))));
  return true;
}

/**
 * Above the other keymaps (priority), so a key beside a tombstone is answered
 * here before Backspace selects the atom it cannot show.
 */
export const TombstoneGuard = Extension.create({
  name: 'tombstoneGuard',
  priority: 1000,

  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction: restoration })];
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => joinAcross(editor.view, -1),
      Delete: ({ editor }) => joinAcross(editor.view, 1),
    };
  },
});

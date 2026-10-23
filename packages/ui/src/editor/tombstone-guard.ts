import { Extension } from '@tiptap/core';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { liftTarget, Mapping } from '@tiptap/pm/transform';
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
 *
 * A tombstone is a top-level HTML block of the file (ADR-0043): one a step
 * moved into a container — the blocks around it wrapped in a quote or a list
 * — would be written as a line of that quote, the person's words and no
 * tombstone. So it is taken back out to the top level where the wrap left it,
 * splitting the container there, and counted wherever it is, so a wrap is
 * never read as a deletion and put back a second time.
 */

const isTombstone = (node: ProseMirrorNode): boolean =>
  node.type.name === 'rawBlock' && isTombstoneBlock(String(node.attrs['markdown'] ?? ''));

interface Held {
  readonly node: ProseMirrorNode;
  readonly pos: number;
  /** Inside a container rather than a block of the note itself. */
  readonly nested: boolean;
}

/** Every tombstone in the note, at any depth, in document order. */
function tombstonesIn(doc: ProseMirrorNode): Held[] {
  const held: Held[] = [];
  doc.descendants((node, pos, parent) => {
    if (isTombstone(node)) held.push({ node, pos, nested: parent !== doc });
    // A textblock holds no blocks: nothing below it is looked at.
    return !node.isTextblock;
  });
  return held;
}

const keyOf = (node: ProseMirrorNode): string => String(node.attrs['markdown']);

/** How many of each tombstone `held` holds, by its bytes. */
function countsOf(held: readonly Held[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { node } of held) counts.set(keyOf(node), (counts.get(keyOf(node)) ?? 0) + 1);
  return counts;
}

/**
 * Lifts the tombstones the step moved into a container back to the top
 * level, last first so none shifts another. One already nested before the
 * step — read so from the file — is left where it is.
 */
function liftMovedIn(tr: Transaction, before: readonly Held[]): void {
  const nestedBefore = countsOf(before.filter(({ nested }) => nested));
  const moved = tombstonesIn(tr.doc).filter(({ node, nested }) => {
    if (!nested) return false;
    const left = nestedBefore.get(keyOf(node)) ?? 0;
    nestedBefore.set(keyOf(node), left - 1);
    return left <= 0;
  });
  for (const { pos } of moved.reverse()) liftToTopLevel(tr, pos);
}

/** Lifts the block at `pos` out of every container it is in, splitting each around it. */
function liftToTopLevel(tr: Transaction, start: number): void {
  let pos = start;
  while (tr.doc.resolve(pos).depth > 0) {
    const node = tr.doc.nodeAt(pos);
    if (node === null) return;
    const range = tr.doc.resolve(pos).blockRange(tr.doc.resolve(pos + node.nodeSize));
    const target = range === null ? null : liftTarget(range);
    // A container it cannot leave (an isolating one): it stays, counted, rather than be duplicated.
    if (range === null || target === null) return;
    const from = tr.steps.length;
    tr.lift(range, target);
    pos = tr.mapping.slice(from).map(pos, 1);
  }
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
  const tr = newState.tr;
  liftMovedIn(tr, before);
  const remaining = countsOf(tombstonesIn(tr.doc));
  const lost = before.filter(({ node }) => {
    const left = remaining.get(keyOf(node)) ?? 0;
    remaining.set(keyOf(node), Math.max(0, left - 1));
    return left === 0;
  });
  if (lost.length === 0) return tr.docChanged ? tr : null;
  const mapping = new Mapping();
  for (const transaction of transactions) mapping.appendMapping(transaction.mapping);
  mapping.appendMapping(tr.mapping);
  // Boundaries are found in the document as it is, then inserted last to first so none shifts another.
  const putBack = lost
    .map(({ node, pos }) => ({ node, at: blockBoundary(tr.doc, mapping.map(pos, -1)) }))
    .sort((one, other) => other.at - one.at);
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

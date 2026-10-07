import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { AttrStep, Mapping, type StepMap } from '@tiptap/pm/transform';
import { BLOCK_ANCHOR_ATTR, isAnchorPlace, type EditorNode } from '@atlas/domain';

/*
 * What a change does to the block ids in it (P26-01, A26-01). Each id stays
 * with the words of the block it names, in the place the file writes it
 * (`isAnchorPlace`), whatever kind of block those words come to be in. A
 * change makes no second holder of an id; one the file already holds twice
 * it leaves as it is — untouched text wins (ADR-0003, ADR-0022).
 *
 * Only what the change touched is looked at: a keystroke costs the same in
 * a note with a thousand ids as in one with none.
 */

/** A stretch of a document, from one position to another. */
interface Stretch {
  readonly from: number;
  readonly to: number;
}

/** A node that holds an id, and where it is. */
interface Holder {
  readonly node: ProseMirrorNode;
  readonly position: number;
  readonly id: string;
}

/** What the change was, as the ids need it. */
export interface IdChange {
  /** The document before the change. */
  readonly before: ProseMirrorNode;
  /** Every step of the change, in order. */
  readonly transactions: readonly Transaction[];
  /** The transaction that puts the ids right, over the document after the change. */
  readonly tr: Transaction;
  /** An undo or a redo: the ids are put back where they were, and not followed. */
  readonly undoing: boolean;
}

/** Keeps each id with its words, and made once, over what the change touched. */
export function keepIds({ before, transactions, tr, undoing }: IdChange): void {
  const { mapping, touched } = changeOf(transactions);
  const back = mapping.invert();
  const touchedBefore = touched.map((stretch) => ({
    from: back.map(stretch.from, -1),
    to: back.map(stretch.to, 1),
  }));
  const was = holdersIn(before, touchedBefore);
  if (!undoing) idsFollowTheirWords({ was, mapping, tr, touched });
  idsMadeOnce({ was, mapping, tr, touched });
}

/**
 * The change's mapping, and the stretches of the document after it that the
 * change wrote: what each step replaced, and each node whose attributes it set.
 */
function changeOf(transactions: readonly Transaction[]): {
  mapping: Mapping;
  touched: Stretch[];
} {
  const steps = transactions.flatMap((transaction) =>
    transaction.steps.map((step, index) => ({ step, map: transaction.mapping.maps[index]! })),
  );
  const mapping = new Mapping(steps.map(({ map }) => map));
  const touched: Stretch[] = [];
  steps.forEach(({ step }, index) => {
    const rest = new Mapping(steps.slice(index + 1).map(({ map }): StepMap => map));
    const add = (from: number, to: number) =>
      touched.push({ from: rest.map(from, -1), to: rest.map(to, 1) });
    mapping.maps[index]!.forEach((_start, _end, from, to) => add(from, to));
    if (step instanceof AttrStep) add(step.pos, step.pos + 1);
  });
  return { mapping, touched };
}

/**
 * Every node holding an id in or beside `stretches` — a stretch's edges
 * widened by one, so a block a change ended at or began at is in it.
 */
function holdersIn(doc: ProseMirrorNode, stretches: readonly Stretch[]): Holder[] {
  const found = new Map<number, Holder>();
  const size = doc.content.size;
  for (const { from, to } of stretches) {
    doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, position) => {
      const id = node.attrs[BLOCK_ANCHOR_ATTR];
      if (typeof id === 'string' && id !== '') found.set(position, { node, position, id });
    });
  }
  return [...found.values()].sort((left, right) => left.position - right.position);
}

/**
 * Keeps each id with the words of the block it named. Enter at the start of
 * a block splits off an empty block above that ProseMirror gives the old
 * block's attributes, Backspace joining a block to the one above keeps only
 * the upper block's, and a paragraph made a list item, a quote or a heading
 * keeps its own attributes inside the new block: the id would part from the
 * place the file writes it. The words are followed through the change; the
 * nearest place around them takes the id, where it has none of its own, and
 * whatever else in the change still holds it lets it go — a block left
 * empty, or one inside that place.
 */
function idsFollowTheirWords({
  was,
  mapping,
  tr,
  touched,
}: {
  was: readonly Holder[];
  mapping: Mapping;
  tr: Transaction;
  touched: readonly Stretch[];
}): void {
  const now = holdersIn(tr.doc, touched);
  for (const { node, position, id } of was) {
    if (stillHolds({ doc: tr.doc, at: mapping.map(position, 1), id })) continue;
    const words = firstWordAt(node, position);
    if (words === null) continue;
    const moved = mapping.mapResult(words, 1);
    if (moved.deleted) continue;
    const place = placeAround(tr.doc, moved.pos);
    const held = place?.node.attrs[BLOCK_ANCHOR_ATTR] ?? null;
    if (place === null || (held !== null && held !== id)) continue;
    for (const other of now) {
      const left = other.node.textContent.trim() === '' || !isPlaceAt(tr.doc, other.position);
      if (other.id === id && other.position !== place.position && left)
        tr.setNodeAttribute(other.position, BLOCK_ANCHOR_ATTR, null);
    }
    if (held === null) tr.setNodeAttribute(place.position, BLOCK_ANCHOR_ATTR, id);
  }
}

/** Whether the node now at `at` still holds `id`, with words, where the file writes it. */
function stillHolds({ doc, at, id }: { doc: ProseMirrorNode; at: number; id: string }): boolean {
  const node = doc.nodeAt(at);
  return (
    node !== null &&
    node.attrs[BLOCK_ANCHOR_ATTR] === id &&
    node.textContent.trim() !== '' &&
    isPlaceAt(doc, at)
  );
}

/**
 * Takes an id off each node the change gave it to — a retag, a split, a
 * drop — while another block holds it. An id that was already held twice
 * before the change is left as it is: the file had it so, and only the
 * blocks the change made are the change's to put right.
 */
function idsMadeOnce({
  was,
  mapping,
  tr,
  touched,
}: {
  was: readonly Holder[];
  mapping: Mapping;
  tr: Transaction;
  touched: readonly Stretch[];
}): void {
  const now = holdersIn(tr.doc, touched);
  const kept = new Set(was.map(({ position, id }) => `${mapping.map(position, 1)}:${id}`));
  for (const id of new Set(now.map((holder) => holder.id))) {
    const before = was.filter((holder) => holder.id === id).length;
    const after = now.filter((holder) => holder.id === id);
    if (after.length <= before) continue;
    const made = after.filter(({ position }) => !kept.has(`${position}:${id}`));
    const others = holdersOf(tr.doc, id).length - made.length;
    // Where nothing else holds it, the first the change made keeps it.
    made.slice(others > 0 ? 0 : 1).forEach(({ position }) => {
      tr.setNodeAttribute(position, BLOCK_ANCHOR_ATTR, null);
    });
  }
}

/** Every node of the document holding `id`: asked only when a change made one. */
function holdersOf(doc: ProseMirrorNode, id: string): number[] {
  const found: number[] = [];
  doc.descendants((node, position) => {
    if (node.attrs[BLOCK_ANCHOR_ATTR] === id) found.push(position);
  });
  return found;
}

/** Where the first character of a block's words is, or null for a block with none. */
function firstWordAt(node: ProseMirrorNode, position: number): number | null {
  let found: number | null = null;
  node.descendants((child, offset) => {
    if (found !== null) return false;
    if (child.isText) found = position + 1 + offset;
    return true;
  });
  return found;
}

/** The nearest node holding `at` that the file writes an id for, and where it starts. */
function placeAround(
  doc: ProseMirrorNode,
  at: number,
): { node: ProseMirrorNode; position: number } | null {
  const $at = doc.resolve(at);
  for (let depth = $at.depth; depth > 0; depth -= 1) {
    const ancestors = typesAbove($at, depth);
    if (isAnchorPlace(asEditorNode($at.node(depth)), ancestors))
      return { node: $at.node(depth), position: $at.before(depth) };
  }
  return null;
}

/** Whether the node starting at `position` is one the file writes an id for. */
function isPlaceAt(doc: ProseMirrorNode, position: number): boolean {
  const node = doc.nodeAt(position);
  if (node === null) return false;
  const $inside = doc.resolve(position + 1);
  return isAnchorPlace(asEditorNode(node), typesAbove($inside, $inside.depth));
}

/** The kinds of the blocks around the node at `depth`, the note's own block first. */
function typesAbove($at: ReturnType<ProseMirrorNode['resolve']>, depth: number): string[] {
  const types: string[] = [];
  for (let level = 1; level < depth; level += 1) types.push($at.node(level).type.name);
  return types;
}

/**
 * As much of a node as `isAnchorPlace` reads: a paragraph's or a heading's
 * words, and an item's first paragraph. Nothing more is copied, so asking
 * of a long list costs no more than asking of a short one.
 */
function asEditorNode(node: ProseMirrorNode): EditorNode {
  const type = node.type.name;
  if (node.isTextblock) {
    const content: EditorNode[] = [];
    node.forEach((child) =>
      content.push(
        child.isText ? { type: 'text', text: child.text ?? '' } : { type: child.type.name },
      ),
    );
    return { type, content };
  }
  const first = node.firstChild;
  return first !== null && (type === 'listItem' || type === 'taskItem')
    ? { type, content: [asEditorNode(first)] }
    : { type };
}

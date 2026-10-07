import type { Editor, Range } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos, Schema } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import {
  BLOCK_ANCHOR_ATTR,
  blockEmbedNode,
  shownBlockLink,
  type EditorNode,
  type NodePath,
  type WikiLinkOrEmbed,
} from '@atlas/domain';

/*
 * The editor's side of linking a block (P26-02): put in the link or the
 * shown block the picker picked, in place of what was typed, and — for a
 * block of this note — give that block its id in the same step, so one undo
 * takes both back.
 */

/** Where the node at `at` — a path of child indexes from the document — starts, or null. */
export function positionOf(doc: ProseMirrorNode, at: NodePath): number | null {
  if (at.length === 0) return null;
  let node = doc;
  let contentStart = 0;
  let position = 0;
  for (const index of at) {
    if (index < 0 || index >= node.childCount) return null;
    position = contentStart;
    for (let before = 0; before < index; before += 1) position += node.child(before).nodeSize;
    node = node.child(index);
    contentStart = position + 1;
  }
  return position;
}

/**
 * Puts `link` in place of `range`. An embed typed on a line of its own, in
 * one of the note's own paragraphs, becomes a shown block there (P26-03), with
 * a line after it to go on typing in; anything else goes in as a link, and a
 * space after it. `anchor` gives one of this note's blocks its id first.
 */
export function insertBlockLink(
  editor: Editor,
  {
    range,
    link,
    anchor = null,
  }: {
    range: Range;
    link: WikiLinkOrEmbed;
    anchor?: { readonly at: NodePath; readonly id: string } | null;
  },
): void {
  const { tr, schema } = editor.state;
  if (anchor !== null) {
    const position = positionOf(tr.doc, anchor.at);
    if (position !== null) tr.setNodeAttribute(position, BLOCK_ANCHOR_ATTR, anchor.id);
  }
  const $from = tr.doc.resolve(range.from);
  if (standsAlone({ $from, range, link })) placeShownBlock(tr, { $from, link, schema });
  else placeLink(tr, { range, link, schema });
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

/**
 * Whether the paragraph `range` is in, with `link` in place of it, stands as
 * a shown block: the one rule the reader holds a note's paragraphs to too.
 */
function standsAlone({
  $from,
  range,
  link,
}: {
  $from: ResolvedPos;
  range: Range;
  link: WikiLinkOrEmbed;
}): boolean {
  const paragraph = $from.parent;
  const start = $from.start();
  const partOf = (part: ProseMirrorNode) => (part.toJSON() as EditorNode).content ?? [];
  const written: EditorNode = {
    type: paragraph.type.name,
    content: [
      ...partOf(paragraph.cut(0, range.from - start)),
      { type: 'wikiLink', attrs: { ...link } },
      ...partOf(paragraph.cut(range.to - start)),
    ],
  };
  return shownBlockLink(written, { topLevel: $from.depth === 1 }) !== null;
}

function placeShownBlock(
  tr: Transaction,
  { $from, link, schema }: { $from: ResolvedPos; link: WikiLinkOrEmbed; schema: Schema },
): void {
  const from = $from.before();
  const shown = schema.nodeFromJSON(blockEmbedNode(link));
  tr.replaceWith(from, $from.after(), shown);
  const after = from + shown.nodeSize;
  const paragraph = schema.nodes['paragraph'];
  if (tr.doc.nodeAt(after) === null && paragraph !== undefined)
    tr.insert(after, paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after + 1, tr.doc.content.size))));
}

function placeLink(
  tr: Transaction,
  { range, link, schema }: { range: Range; link: WikiLinkOrEmbed; schema: Schema },
): void {
  const wikiLink = schema.nodes['wikiLink'];
  if (wikiLink === undefined) return;
  const node = wikiLink.create({
    target: link.target,
    heading: link.heading,
    alias: link.alias,
    embed: link.embed,
  });
  tr.replaceWith(range.from, range.to, [node, schema.text(' ')]);
  tr.setSelection(TextSelection.create(tr.doc, range.from + node.nodeSize + 1));
}

/**
 * `range`, followed through every change the editor makes until `release`:
 * where the typed text still is once a write to another note has settled.
 */
export function followRange(
  editor: Editor,
  range: Range,
): { current: () => Range; release: () => void } {
  let current = range;
  const follow = ({ transaction }: { transaction: Transaction }) => {
    current = {
      from: transaction.mapping.map(current.from, -1),
      to: transaction.mapping.map(current.to, -1),
    };
  };
  editor.on('transaction', follow);
  return { current: () => current, release: () => editor.off('transaction', follow) };
}

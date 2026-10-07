import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import {
  BOOKMARK_NODE,
  linkSwitchFor,
  paragraphOfBookmark,
  paragraphWithBookmark,
  type EditorNode,
  type LinkSwitch,
} from '@atlas/domain';

/*
 * The editor's side of switching a link between a link and a bookmark
 * (P22-02): find the block the link is in, ask the domain what it becomes,
 * and put that in its place. Nothing but that block changes, so every other
 * block keeps its bytes when the note is saved (ADR-0003).
 */

/** Which way the link at `at` can switch, as the domain says for where it stands (`linkSwitchFor`). */
export function linkSwitchAt(editor: Editor, at: number): LinkSwitch | null {
  const node = editor.state.doc.nodeAt(at);
  const $at = editor.state.doc.resolve(at);
  return linkSwitchFor({
    node: node === null ? null : (node.toJSON() as EditorNode),
    parent: $at.parent.type.name,
    depth: $at.depth,
  });
}

/** Shows the wiki link at `at` as a bookmark. False when it cannot be. */
export function showAsBookmark(editor: Editor, at: number): boolean {
  if (linkSwitchAt(editor, at) !== 'bookmark') return false;
  const $at = editor.state.doc.resolve(at);
  const paragraph = $at.parent.toJSON() as EditorNode;
  const blocks = paragraphWithBookmark(paragraph, $at.index());
  if (blocks === null) return false;
  const from = $at.before();
  const nodes = replaceBlock(editor, { from, to: $at.after(), blocks });
  const before = nodes.slice(
    0,
    blocks.findIndex((block) => block.type === BOOKMARK_NODE),
  );
  selectAfterBookmark(
    editor,
    before.reduce((position, node) => position + node.nodeSize, from),
  );
  return true;
}

/** Shows the bookmark at `at` as a link again, alone in its paragraph. False when it cannot be. */
export function showAsLink(editor: Editor, at: number): boolean {
  const node = editor.state.doc.nodeAt(at);
  const paragraph = node === null ? null : paragraphOfBookmark(node.toJSON() as EditorNode);
  if (node === null || paragraph === null) return false;
  replaceBlock(editor, { from: at, to: at + node.nodeSize, blocks: [paragraph] });
  // The caret goes just after the link — into the paragraph (1), past the link (1).
  editor
    .chain()
    .setTextSelection(at + 2)
    .focus()
    .run();
  return true;
}

/** Puts `blocks` in place of the block from `from` to `to`, handing back the nodes made. */
function replaceBlock(
  editor: Editor,
  { from, to, blocks }: { from: number; to: number; blocks: readonly EditorNode[] },
): ProseMirrorNode[] {
  const { schema, tr } = editor.state;
  const nodes = blocks.map((block) => schema.nodeFromJSON(block));
  editor.view.dispatch(tr.replaceWith(from, to, nodes).scrollIntoView());
  return nodes;
}

/**
 * Puts the caret in the block after the bookmark — making an empty paragraph
 * there when the card is the last thing in the note, so there is somewhere
 * to go on typing.
 */
function selectAfterBookmark(editor: Editor, at: number): void {
  const card = editor.state.doc.nodeAt(at);
  if (card === null) return;
  const after = at + card.nodeSize;
  let { tr } = editor.state;
  if (editor.state.doc.nodeAt(after) === null) {
    tr = tr.insert(after, editor.state.schema.nodes['paragraph']!.create());
  }
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
  editor.view.dispatch(tr);
  editor.commands.focus();
}

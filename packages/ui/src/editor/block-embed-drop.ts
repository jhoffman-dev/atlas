import { DOMParser as NodeParser, type Node as ProseNode } from '@tiptap/pm/model';
import { Plugin, type EditorState, type Transaction } from '@tiptap/pm/state';
import { BLOCK_EMBED_NODE } from '@dfai/domain';

/*
 * A highlight dragged from All highlights (#507) carries its embed as HTML
 * and as text. ProseMirror drops a block where blocks go, but over a code
 * block it takes the plain text instead — and `![[…]]` would be written into
 * the code. A block embed is never code: dropped over code it goes after the
 * code block, where a block goes.
 */

/** The block embeds in dragged `html`, parsed in an inert document (nothing in it loads or runs); none for anything else. */
function embedsIn(html: string, state: EditorState): ProseNode[] {
  const parsed = new window.DOMParser().parseFromString(html, 'text/html');
  const content = NodeParser.fromSchema(state.schema).parseSlice(parsed.body).content;
  const nodes: ProseNode[] = [];
  content.forEach((node) => nodes.push(node));
  return nodes.length > 0 && nodes.every((node) => node.type.name === BLOCK_EMBED_NODE)
    ? nodes
    : [];
}

/**
 * The drop of the embeds in `html` at `pos` when `pos` is inside a code
 * block: after that block. Null — ProseMirror's own drop to make, as any
 * drop over code was before #507 — when it is not inside code, or `html` is
 * not block embeds alone: text that only names `data-block-embed`, or an
 * embed dragged with other blocks.
 */
export function embedDropOverCode(
  state: EditorState,
  { pos, html }: { pos: number; html: string },
): Transaction | null {
  const $pos = state.doc.resolve(pos);
  let codeDepth = -1;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.code === true) codeDepth = depth;
  }
  if (codeDepth < 0) return null;
  const embeds = embedsIn(html, state);
  return embeds.length === 0 ? null : state.tr.insert($pos.after(codeDepth), embeds);
}

/** The plugin that applies {@link embedDropOverCode} to a drop from All highlights. */
export const blockEmbedDrop = () =>
  new Plugin({
    props: {
      handleDrop: (view, event, _slice, moved) => {
        const html = event.dataTransfer?.getData('text/html') ?? '';
        if (moved || !html.includes('data-block-embed')) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at === null) return false;
        const dropped = embedDropOverCode(view.state, { pos: at.pos, html });
        if (dropped === null) return false;
        event.preventDefault();
        if (dropped.docChanged) view.dispatch(dropped.scrollIntoView());
        return true;
      },
    },
  });

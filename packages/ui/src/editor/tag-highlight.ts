import { Extension } from '@tiptap/core';
import { Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findTags } from '@atlas/domain';

/** Text whose `#` is never a tag: code, and a link's words. */
const NOT_TAGGED_MARKS: ReadonlySet<string> = new Set(['code', 'link']);

/**
 * Inline nodes that sit inside a run of text in the note's source: a
 * `[[link]]` is text to the markdown parser, so a `#` right after its `]]`
 * is not a tag there, nor may one run into it.
 */
const IN_TEXT_RUN: ReadonlySet<string> = new Set(['wikiLink']);

/** Stands in for such a node: one position, and neither a word nor a space. */
const IN_TEXT_NODE = '\uFFFC';

/**
 * A block's runs of text as the note's source has them: a run ends where
 * the marks change (the markdown parser splits text at `**`, `_` and the
 * like) or at a node that is not text, such as a line break or an image.
 */
function textRuns(block: ProseMirrorNode, start: number): { from: number; text: string }[] {
  const runs: { from: number; text: string; marks: readonly Mark[] }[] = [];
  let current: (typeof runs)[number] | null = null;
  block.forEach((child, offset) => {
    if (!child.isText && !IN_TEXT_RUN.has(child.type.name)) {
      current = null;
      return;
    }
    if (current === null || !Mark.sameSet(current.marks, child.marks)) {
      current = { from: start + offset, text: '', marks: child.marks };
      runs.push(current);
    }
    current.text += child.isText ? (child.text ?? '') : IN_TEXT_NODE;
  });
  return runs.filter((run) => !run.marks.some((mark) => NOT_TAGGED_MARKS.has(mark.type.name)));
}

/** The tags in one text block, which starts at `position`. */
function blockDecorations(block: ProseMirrorNode, position: number): Decoration[] {
  if (block.type.spec.code === true) return [];
  return textRuns(block, position + 1).flatMap((run) =>
    findTags(run.text).map((tag) =>
      Decoration.inline(run.from + tag.start, run.from + tag.end, {
        nodeName: 'span',
        class: 'tag',
        'data-tag': tag.name,
      }),
    ),
  );
}

/** Where the tags are in a whole document, block by block. */
function tagDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    decorations.push(...blockDecorations(node, position));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * The decorations after an edit: the old ones moved along, and only the text
 * blocks the edit touched read again. A tag never crosses a block, so what
 * lies outside them cannot have changed.
 */
function updatedDecorations(transaction: Transaction, previous: DecorationSet): DecorationSet {
  const doc = transaction.doc;
  const touched: { from: number; to: number }[] = [];
  transaction.steps.forEach((step, at) => {
    const rest = transaction.mapping.slice(at + 1);
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      touched.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1) });
    });
    // A mark or an attribute changed moves nothing, yet can split a text run.
    const { from, to, pos } = step as unknown as { from?: number; to?: number; pos?: number };
    const start = from ?? pos;
    if (start === undefined) return;
    const after = transaction.mapping.slice(at);
    touched.push({ from: after.map(start, -1), to: after.map(to ?? start, 1) });
  });

  let decorations = previous.map(transaction.mapping, doc);
  const blocks = new Map<number, ProseMirrorNode>();
  for (const { from, to } of touched) {
    doc.nodesBetween(
      Math.max(0, from - 1),
      Math.min(doc.content.size, to + 1),
      (node, position) => {
        if (!node.isTextblock) return true;
        blocks.set(position, node);
        return false;
      },
    );
  }
  for (const [position, block] of blocks) {
    const end = position + block.nodeSize;
    decorations = decorations
      .remove(decorations.find(position, end))
      .add(doc, blockDecorations(block, position));
  }
  return decorations;
}

export interface TagHighlightOptions {
  /** Opens the notes with a tag, by its name as written; null where tags do not open. */
  onOpen: ((name: string) => void) | null;
}

/**
 * Draws each `#tag` as a tag, which a click opens.
 *
 * Tags stay text in the document — a mark or a node would have to be kept in
 * step with every keystroke, and Bear's `#tag me#` is not a tag until its
 * closing `#` is typed. Decorations are worked out from the text, so what is
 * drawn as a tag is always what the grammar says is one, and what is saved is
 * the text as typed (written verbatim by the serializer, ADR-0004). Each edit
 * rereads only the blocks it touched, so typing in a long note stays cheap.
 */
export const TagHighlight = Extension.create<TagHighlightOptions>({
  name: 'tagHighlight',

  addOptions() {
    return { onOpen: null };
  },

  addProseMirrorPlugins() {
    const { onOpen } = this.options;
    return [
      new Plugin({
        key: new PluginKey('tagHighlight'),
        state: {
          init: (_, state) => tagDecorations(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged ? updatedDecorations(transaction, previous) : previous,
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          // Taken on the press, before the caret moves into the tag and the
          // `#` suggestion redraws the text under the pointer.
          handleClick(_view, _position, event) {
            const target = event.target instanceof Element ? event.target : null;
            const tag = target?.closest('[data-tag]')?.getAttribute('data-tag') ?? null;
            if (tag === null || onOpen === null) return false;
            event.preventDefault();
            onOpen(tag);
            return true;
          },
        },
      }),
    ];
  },
});

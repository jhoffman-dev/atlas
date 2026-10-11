import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { checklistLines, type EditorDocument, type NodePath } from '@atlas/domain';

/** A checklist line asked to become a task: its place among the note's boxes, and its words. */
export interface PromotedLine {
  readonly index: number;
  readonly text: string;
}

/** Called when the person asks for a line to become a task. */
export type PromoteLine = (line: PromotedLine) => void;

export interface PromoteLineOptions {
  /** Null where a line cannot be promoted: no button is drawn. */
  readonly promote: PromoteLine | null;
}

const promoteLine = new PluginKey<DecorationSet>('promoteLine');

/** The keys that promote the line the caret is in, as the button does. */
export const PROMOTE_LINE_KEYS = 'Mod-Shift-Enter';

/**
 * "Make task" on the checklist line the caret is in (P30-03): a button after
 * its words, and ⌘⇧↩, which hand the line — as `checklistLines` counts and
 * reads it, the rule the index and the write both use — to `promote`. Only a
 * line with words is offered: there is nothing to name a task by in an empty one.
 */
export const PromoteLineButton = Extension.create<PromoteLineOptions>({
  name: 'promoteLine',

  addOptions() {
    return { promote: null };
  },

  addKeyboardShortcuts() {
    const { promote } = this.options;
    if (promote === null) return {};
    return {
      [PROMOTE_LINE_KEYS]: ({ editor }) => promoteCaretLine(editor.view, promote),
    };
  },

  addProseMirrorPlugins() {
    const { promote } = this.options;
    if (promote === null) return [];
    return [
      new Plugin<DecorationSet>({
        key: promoteLine,
        props: {
          decorations: (state) => {
            const line = caretLine(state);
            if (line === null) return null;
            const button = Decoration.widget(line.end, (view) => buttonFor(view, promote), {
              side: 1,
              key: `promote-${line.end}`,
              ignoreSelection: true,
            });
            return DecorationSet.create(state.doc, [button]);
          },
        },
      }),
    ];
  },
});

/** The checklist line the caret is in: where its item is, and where its own words end. */
function caretLine(state: EditorState): { at: NodePath; end: number } | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  const depth = itemDepth($from);
  if (depth === null) return null;
  const item = $from.node(depth);
  const words = item.firstChild;
  if (words === null || words.type.name !== 'paragraph' || words.textContent.trim() === '') {
    return null;
  }
  const start = $from.before(depth) + 1;
  return { at: pathTo($from, depth), end: start + words.nodeSize - 1 };
}

/** How deep the nearest checklist item around `$from` is, or null when it is in none. */
function itemDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'taskItem') return depth;
  }
  return null;
}

/** The path of child indexes from the document to the node at `depth` around `$from`. */
function pathTo($from: ResolvedPos, depth: number): NodePath {
  return Array.from({ length: depth }, (_, level) => $from.index(level));
}

function buttonFor(view: EditorView, promote: PromoteLine): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'promote-line';
  button.contentEditable = 'false';
  button.textContent = 'Make task';
  button.setAttribute('aria-label', 'Make this line a task');
  button.setAttribute('aria-keyshortcuts', 'Meta+Shift+Enter');
  button.title = 'Make this line a task (⌘⇧↩)';
  // Pressed rather than clicked, and kept from the editor, so the caret stays where it was.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    promoteCaretLine(view, promote);
  });
  return button;
}

/**
 * Hands the line the caret is in to `promote`, read as the note is now — the
 * button outlives the state it was drawn in. False when the caret is in none.
 */
function promoteCaretLine(view: EditorView, promote: PromoteLine): boolean {
  const caret = caretLine(view.state);
  const line = caret === null ? null : lineAt(view.state.doc, caret.at);
  if (line === null) return false;
  promote(line);
  return true;
}

/** The line at `at`, as the note's checklist counts and reads it. */
function lineAt(doc: ProseMirrorNode, at: NodePath): PromotedLine | null {
  const lines = checklistLines(doc.toJSON() as EditorDocument);
  const index = lines.findIndex(
    (line) => line.at.length === at.length && line.at.every((step, i) => step === at[i]),
  );
  const line = lines[index];
  return line === undefined ? null : { index, text: line.text };
}

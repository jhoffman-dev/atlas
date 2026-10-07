import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { BOOKMARK_NODE } from '@atlas/domain';

/**
 * Raised on the editor's element to open a link's menu: `detail` says which
 * link (its position) and what to hang the menu from. The page owns the menu,
 * as it owns the note picker `/link` asks for.
 */
export const LINK_MENU_REQUEST = 'atlas:link-menu';

/** Raised on the editor's element to open the note a selected bookmark links to. */
export const FOLLOW_REQUEST = 'atlas:follow-link';

export interface LinkMenuRequest {
  readonly at: number;
  readonly anchor: Element;
}

/** Asks for the menu of the link at `at`, hung from `anchor` — which is in the editor. */
export function requestLinkMenu(anchor: Element, at: number): void {
  const editorElement = anchor.closest('.ProseMirror');
  const detail: LinkMenuRequest = { at, anchor };
  editorElement?.dispatchEvent(new CustomEvent(LINK_MENU_REQUEST, { detail }));
}

const LINKS: ReadonlySet<string> = new Set(['wikiLink', BOOKMARK_NODE]);

/**
 * The position of the link the selection is on: a link or bookmark selected
 * whole, or a link the caret sits against — just after it first, as it is
 * after one is typed. Null when there is none.
 */
export function linkAtSelection(editor: Editor): number | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) {
    return LINKS.has(selection.node.type.name) ? selection.from : null;
  }
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.nodeBefore?.type.name === 'wikiLink') return $from.pos - $from.nodeBefore.nodeSize;
  if ($from.nodeAfter?.type.name === 'wikiLink') return $from.pos;
  return null;
}

/**
 * The keys a link answers to from the keyboard: Shift+F10 or the menu key
 * opens its menu, as they open a row's in the sidebar. On a selected
 * bookmark, Mod-Enter opens its note, as a click does, and Enter starts a
 * new paragraph after it, as Enter does after any other block (A22-01).
 */
export const LinkKeys = Extension.create({
  name: 'linkKeys',
  // Ahead of the keymaps that would split or add a paragraph on Enter.
  priority: 1000,

  addKeyboardShortcuts() {
    const openMenu = () => {
      const at = linkAtSelection(this.editor);
      const anchor = at === null ? null : this.editor.view.nodeDOM(at);
      if (at === null || !(anchor instanceof Element)) return false;
      this.editor.view.dom.dispatchEvent(
        new CustomEvent(LINK_MENU_REQUEST, { detail: { at, anchor } satisfies LinkMenuRequest }),
      );
      return true;
    };
    return {
      'Shift-F10': openMenu,
      ContextMenu: openMenu,
      'Mod-Enter': () => {
        const card = selectedBookmark(this.editor);
        if (card === null) return false;
        const target = String(card.attrs['target'] ?? '');
        this.editor.view.dom.dispatchEvent(new CustomEvent(FOLLOW_REQUEST, { detail: target }));
        return true;
      },
      Enter: () => {
        if (selectedBookmark(this.editor) === null) return false;
        const { state } = this.editor;
        const after = state.selection.to;
        const tr = state.tr.insert(after, state.schema.nodes['paragraph']!.create());
        this.editor.view.dispatch(
          tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView(),
        );
        return true;
      },
    };
  },
});

/** The bookmark selected whole, or null when the selection is anything else. */
function selectedBookmark(editor: Editor) {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === BOOKMARK_NODE
    ? selection.node
    : null;
}

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

/** What a person can focus and press: a link, a button, a field, or anything given a tab stop. */
const CONTROL =
  'a[href], button, input, select, textarea, [role="link"], [role="button"], [tabindex]';

/**
 * The control a key was pressed on, when it is one drawn inside the document
 * rather than in its text: "Open in PDF" in a highlight's block (#506), an embed's
 * name, a card's button. Such a control is not editable — its nearest
 * `contenteditable` says false — so the key is the control's: the editor's
 * keys (Enter, ⇧↩ and ⌘↩'s hard break, Backspace, typing) would act on the
 * selection instead, which is often the very block the control is in.
 * Null for a key pressed anywhere else.
 */
function controlKeyedOn(editorElement: Element, target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(CONTROL);
  if (control === null || control === editorElement || !editorElement.contains(control)) {
    return null;
  }
  const editable = control.closest('[contenteditable]')?.getAttribute('contenteditable');
  return editable === 'false' ? control : null;
}

/** Fields take typing, undo and the rest as their own: no key on one is kept from the browser. */
const FIELD = 'input, select, textarea';

/** Whether the key is the control's own answer: a button presses on Enter and Space. */
const pressesControl = (control: Element, event: KeyboardEvent): boolean =>
  control.matches('button') && (event.key === 'Enter' || event.key === ' ');

/** ⌘ or Ctrl shortcuts WebKit answers in editable text itself: undo, redo, bold, italic, underline. */
const NATIVE_EDITING_SHORTCUTS = new Set(['z', 'y', 'b', 'i', 'u']);

/**
 * Whether the browser would act on the key itself: Backspace goes Back in
 * WebKit; Enter, Delete, typing and the native editing shortcuts (⌘Z's own
 * undo) edit, or move, what the page's selection is in — here, the note
 * around the control. Other shortcuts (⌘K) are the app's.
 */
function actsNatively(event: KeyboardEvent): boolean {
  if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') return true;
  if (event.metaKey || event.ctrlKey) return NATIVE_EDITING_SHORTCUTS.has(event.key.toLowerCase());
  return event.key.length === 1;
}

/** Whether the browser's answer to the key, pressed on `control`, would land in the note around it. */
const leaksToNote = (control: Element, event: KeyboardEvent): boolean =>
  !control.matches(FIELD) && !pressesControl(control, event) && actsNatively(event);

/**
 * Leaves keys pressed on a control in the document to the control. The
 * editor never looks at them, so none edits the note, and on a link or the
 * like the browser's own answer to an editing key is prevented too; they
 * still bubble to what holds the editor, which follows a link on Enter with
 * its modifiers. First of the editor's plugins, so no keymap or suggestion
 * list sees them.
 *
 * The browser's answer is prevented from a listener on the editor's element,
 * in the capture phase, not from `handleDOMEvents`: a node view's
 * `stopEvent` (a React node view's passes every key in it, PR #522) keeps
 * ProseMirror's handlers from ever seeing keys pressed on its controls, an
 * embed's name or a highlight's chip, and WebKit would go Back on them.
 */
export const ControlKeys = Extension.create({
  name: 'controlKeys',
  // TipTap orders plugins by priority, highest first; the default is 100.
  priority: 10_000,

  addProseMirrorPlugins() {
    const onControl = (element: Element, event: KeyboardEvent): boolean =>
      controlKeyedOn(element, event.target) !== null;
    return [
      new Plugin({
        view: (view) => {
          const keepFromBrowser = (event: Event) => {
            if (!(event instanceof KeyboardEvent)) return;
            const control = controlKeyedOn(view.dom, event.target);
            if (control !== null && leaksToNote(control, event)) event.preventDefault();
          };
          view.dom.addEventListener('keydown', keepFromBrowser, true);
          view.dom.addEventListener('keypress', keepFromBrowser, true);
          return {
            destroy: () => {
              view.dom.removeEventListener('keydown', keepFromBrowser, true);
              view.dom.removeEventListener('keypress', keepFromBrowser, true);
            },
          };
        },
        props: {
          handleDOMEvents: {
            keydown: (view, event) => onControl(view.dom, event),
            keypress: (view, event) => onControl(view.dom, event),
          },
        },
      }),
    ];
  },
});

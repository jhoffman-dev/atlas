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

/** Controls that answer keys of their own: a button presses on Enter, a field takes typing. */
const FORM_CONTROL = 'button, input, select, textarea';

/**
 * Whether the browser would act on the key itself: Backspace goes Back in
 * WebKit, Enter, Delete and typing edit what the page's selection is in —
 * here, the note around the control. Shortcuts (⌘ or Ctrl) are the app's.
 */
const actsNatively = (event: KeyboardEvent): boolean =>
  event.key === 'Backspace' ||
  event.key === 'Delete' ||
  event.key === 'Enter' ||
  (event.key.length === 1 && !event.metaKey && !event.ctrlKey);

/**
 * Leaves keys pressed on a control in the document to the control. The
 * editor never looks at them, so none edits the note, and on a link or the
 * like the browser's own answer to an editing key is prevented too; they
 * still bubble to what holds the editor, which follows a link on Enter with
 * its modifiers. First of the editor's plugins, so no keymap or suggestion
 * list sees them.
 */
export const ControlKeys = Extension.create({
  name: 'controlKeys',
  // TipTap orders plugins by priority, highest first; the default is 100.
  priority: 10_000,

  addProseMirrorPlugins() {
    const onControl = (element: Element, event: KeyboardEvent): boolean => {
      const control = controlKeyedOn(element, event.target);
      if (control === null) return false;
      if (!control.matches(FORM_CONTROL) && actsNatively(event)) event.preventDefault();
      return true;
    };
    return [
      new Plugin({
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

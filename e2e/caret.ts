/**
 * Putting the editor's caret at a line's end or start, and waiting until the
 * editor holds it there (#445, #448).
 *
 * The click lands at the line's start on purpose: where a click lands is not
 * to be relied on, so the key that follows must move the caret from anywhere
 * on the line. End and Home do not: in WebKit on macOS they scroll and leave
 * the caret where it was. ⌘→ and ⌘← are the Mac's end and start of line.
 *
 * And the key alone is not enough. For 20 ms after it is focused, ProseMirror
 * puts its own selection back on the page unless it has read the page's by
 * then; under load the caret the key moved is put back at the note's start,
 * and the typing after it lands there. So the editor's own selection is what
 * is waited on, and the key pressed again if it was undone (where it already
 * is, ⌘→ changes nothing). Pressing it also collapses the word or line a
 * quick second or third click on the same spot selects.
 *
 * ⌘→ goes to the end of the line as drawn, so on a paragraph that wraps it
 * stops short of the block's end: the check then fails loudly, never passes.
 */
import { expect, type Locator } from '@playwright/test';

/** Click the line `line` is in, and put the caret at that line's end. */
export async function caretAtLineEnd(line: Locator): Promise<void> {
  await caretAt(line, 'end');
}

/** Click the line `line` is in, and put the caret at that line's start. */
export async function caretAtLineStart(line: Locator): Promise<void> {
  await caretAt(line, 'start');
}

async function caretAt(line: Locator, where: 'start' | 'end'): Promise<void> {
  await line.click({ position: { x: 1, y: 5 } });
  // Always pressed, never skipped when the editor already says the caret is
  // there: until ProseMirror reads the click, its selection is the one from
  // before, and the typing goes where the click put the page's caret. ⌘← is
  // pressed from the line's end: at a line's start under a bookmark card, it
  // takes the caret up to the line above.
  const keys = where === 'end' ? ['Meta+ArrowRight'] : ['Meta+ArrowRight', 'Meta+ArrowLeft'];
  await expect(async () => {
    for (const key of keys) await line.page().keyboard.press(key);
    expect(await editorCaret(line)).toEqual({ inLine: true, at: where });
  }).toPass({ timeout: 5_000 });
}

/**
 * Where the editor that holds `line` has its caret: whether it is in the
 * block `line` is in, and whether at that block's start, end, or neither.
 */
function editorCaret(line: Locator) {
  return line.evaluate((element) => {
    // Tiptap hangs the editor on ProseMirror's element; its selection is not in the DOM.
    interface Head {
      parentOffset: number;
      parent: { content: { size: number } };
      before(): number;
    }
    const root = element.closest('.ProseMirror') as
      | (Element & {
          editor: {
            state: { selection: { empty: boolean; $head: Head } };
            view: { nodeDOM(pos: number): Node | null };
          };
        })
      | null;
    if (root === null) throw new Error('the line is not in an editor');
    const { selection } = root.editor.state;
    const { $head } = selection;
    const block = root.editor.view.nodeDOM($head.before());
    const at = !selection.empty
      ? 'neither'
      : $head.parentOffset === $head.parent.content.size
        ? 'end'
        : $head.parentOffset === 0
          ? 'start'
          : 'neither';
    return { inLine: block !== null && block.contains(element), at };
  });
}

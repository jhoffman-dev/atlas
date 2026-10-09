// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorDocument, EditorNode } from '@atlas/domain';
import { NoteEditor } from './note-editor.tsx';
import type { PromoteLine } from './editor/promote-line.ts';

/**
 * P30-03: the checklist line the caret is in offers "Make task", and hands
 * the line — counted and read as the index and the write read it — to the page.
 */

afterEach(cleanup);

beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  Element.prototype.scrollIntoView = () => {};
});

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string): EditorNode => ({
  type: 'paragraph',
  ...(value === '' ? {} : { content: [text(value)] }),
});
const box = (words: string, checked: boolean, ...nested: EditorNode[]): EditorNode => ({
  type: 'taskItem',
  attrs: { checked },
  content: [paragraph(words), ...nested],
});
const tasks = (...items: EditorNode[]): EditorNode => ({ type: 'taskList', content: items });

const NOTE: EditorDocument = {
  type: 'doc',
  content: [
    paragraph('Before the list'),
    tasks(box('Book the hall', true, tasks(box('Count the guests', false))), box('', false)),
    tasks(box('Order chairs', false)),
  ],
};

async function editorIn(container: HTMLElement): Promise<Editor> {
  const element = await waitFor(() => {
    const found = container.querySelector('.ProseMirror');
    if (found === null) throw new Error('no editor yet');
    return found;
  });
  return (element as HTMLElement & { editor: Editor }).editor;
}

function renderEditor(onPromoteLine?: PromoteLine) {
  return render(
    <NoteEditor
      doc={NOTE}
      onChange={() => {}}
      onFollowLink={() => {}}
      suggestNotes={() => []}
      loadImage={async () => null}
      {...(onPromoteLine !== undefined && { onPromoteLine })}
    />,
  );
}

/** Puts the caret in the first text that says `words`. */
function caretIn(editor: Editor, words: string) {
  let at = -1;
  editor.state.doc.descendants((node, position) => {
    if (at === -1 && node.isText && node.text === words) at = position + 1;
  });
  if (at === -1) throw new Error(`no ${words}`);
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  });
}

const buttons = (container: HTMLElement) =>
  container.querySelectorAll<HTMLButtonElement>('button.promote-line');

function press(button: HTMLButtonElement | undefined) {
  if (button === undefined) throw new Error('no button');
  act(() => {
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
}

describe('Make task on a checklist line', () => {
  it('is offered on the line the caret is in, and only there', async () => {
    const { container } = renderEditor(vi.fn());
    const editor = await editorIn(container);
    caretIn(editor, 'Before the list');
    expect(buttons(container)).toHaveLength(0);
    caretIn(editor, 'Order chairs');
    expect(buttons(container)).toHaveLength(1);
    expect(buttons(container)[0]?.closest('li')?.textContent).toContain('Order chairs');
  });

  it('hands over the line as the note’s checklist counts it, nested lines included', async () => {
    const promote = vi.fn<PromoteLine>();
    const { container } = renderEditor(promote);
    const editor = await editorIn(container);
    caretIn(editor, 'Order chairs');
    press(buttons(container)[0]);
    expect(promote).toHaveBeenCalledWith({ index: 3, text: 'Order chairs' });
    caretIn(editor, 'Count the guests');
    press(buttons(container)[0]);
    expect(promote).toHaveBeenLastCalledWith({ index: 1, text: 'Count the guests' });
  });

  it('answers ⌘⇧↩ as the button does', async () => {
    const promote = vi.fn<PromoteLine>();
    const { container } = renderEditor(promote);
    const editor = await editorIn(container);
    caretIn(editor, 'Book the hall');
    // `Mod` is ⌘ on a Mac and Ctrl elsewhere; jsdom says it is not a Mac.
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    act(() => {
      editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event));
    });
    expect(promote).toHaveBeenCalledWith({ index: 0, text: 'Book the hall' });
  });

  it('is not offered on an empty line, nor in a note that cannot promote', async () => {
    const empty = renderEditor(vi.fn());
    const editor = await editorIn(empty.container);
    act(() => {
      // The empty box: after the nested list, the second item of the first list.
      let at = -1;
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === 'taskItem' && node.textContent === '') at = position + 2;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
      );
    });
    expect(buttons(empty.container)).toHaveLength(0);
    cleanup();

    const unoffered = renderEditor();
    caretIn(await editorIn(unoffered.container), 'Order chairs');
    expect(buttons(unoffered.container)).toHaveLength(0);
  });
});

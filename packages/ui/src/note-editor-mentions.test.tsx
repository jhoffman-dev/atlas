// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { EditorDocument, MentionSuggestion } from '@atlas/domain';
import { NoteEditor } from './note-editor.tsx';

/**
 * What a note hands over to be saved while a person made from `@` is still
 * being made (A21-02): the placeholder standing where the `@` was is the
 * editor's alone, and never reaches the file.
 */

afterEach(cleanup);

const CREATE: MentionSuggestion = { kind: 'create', name: 'Ann Lee' };
const empty: EditorDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

function typeInto(instance: Editor, text: string) {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const handled = instance.view.someProp('handleTextInput', (handle) =>
      handle(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)),
    );
    if (handled !== true) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
  }
}

async function editorIn(container: HTMLElement): Promise<Editor> {
  const element = await waitFor(() => {
    const found = container.querySelector('.ProseMirror');
    if (found === null) throw new Error('no editor yet');
    return found;
  });
  // TipTap hangs the editor on its element.
  return (element as HTMLElement & { editor: Editor }).editor;
}

describe('a note saved while a person is being made from @', () => {
  it('is handed over without the placeholder, then with the link once they exist', async () => {
    let finish!: (target: string) => void;
    const onChange = vi.fn<(doc: EditorDocument) => void>();
    const { container } = render(
      <NoteEditor
        doc={empty}
        onChange={onChange}
        onFollowLink={() => {}}
        suggestNotes={() => []}
        loadImage={async () => null}
        people={{
          suggest: () => [CREATE],
          create: () =>
            new Promise<string>((settle) => {
              finish = settle;
            }),
          personFor: () => null,
          notLinked: () => {},
        }}
      />,
    );
    const instance = await editorIn(container);
    instance.commands.focus('end');
    typeInto(instance, 'With @Ann Lee');
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Create person/ }));
    typeInto(instance, 'will call');

    // The placeholder is on screen, and not in what is saved.
    expect(container.querySelector('.mention-pending')).not.toBeNull();
    const saved = onChange.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(saved)).not.toContain('mention');
    // As the paragraph would read with the placeholder's words left out.
    expect(saved?.content?.[0]?.content).toEqual([{ type: 'text', text: 'With  will call' }]);

    finish('Ann Lee');
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0].content?.[0]?.content).toEqual([
        { type: 'text', text: 'With ' },
        {
          type: 'wikiLink',
          attrs: { target: 'Ann Lee', heading: null, alias: null, embed: false },
        },
        { type: 'text', text: ' will call' },
      ]),
    );
  });
});

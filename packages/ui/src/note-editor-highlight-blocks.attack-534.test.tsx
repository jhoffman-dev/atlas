// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { EditorDocument, HighlightView } from '@dfai/domain';
import { NoteEditor, type NoteHighlights } from './note-editor.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

/*
 * Attack tests for PR #534 (#523): a highlight's comment typed in place.
 * What the person typed in the field is theirs until it is written or they
 * put it back with Escape — a note read again, the pane closing, or a key an
 * input method is still composing must not throw it away. And a literature
 * note of many highlights must not redraw them all on every keystroke.
 */

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

afterEach(cleanup);

beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  Element.prototype.scrollIntoView = () => {};
});

const doc = (...content: EditorDocument['content']): EditorDocument => ({ type: 'doc', content });

const MARKER =
  '<!-- atlas:highlight {"v":1,"mark":"underline","color":"green","kind":"kindle","location":41} -->';
const block = (quote: string, comment: string) =>
  [`> ${quote}`, `> ${MARKER}`, ...(comment === '' ? [] : ['>', `> ${comment}`])].join('\n');

/** The same stand-in reader as note-editor-highlight-blocks.test.tsx: read from the block itself. */
const viewOf = ({ markdown, id }: { markdown: string; id: string }): HighlightView | null => {
  const lines = markdown.split('\n').map((line) => line.replace(/^> ?/, ''));
  const at = lines.findIndex((line) => line.startsWith('<!-- atlas:highlight '));
  if (at < 1) return null;
  return {
    id,
    words: lines.slice(0, at).join('\n'),
    picture: null,
    comment: lines.slice(at + 2).join('\n'),
    mark: 'underline',
    color: 'green',
  };
};

const lamp = (comment: string) =>
  doc(
    { type: 'rawBlock', attrs: { markdown: block('The last lamp.', comment), anchor: 'k3x9q2' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'My own words.' }] },
  );

function renderNote(initial: EditorDocument) {
  const editComment = vi.fn<NoteHighlights['editComment']>(async () => {});
  const props = {
    onChange: vi.fn(),
    onFollowLink: vi.fn(),
    suggestNotes: () => [],
    loadImage: async () => null,
    highlights: { viewOf, editComment },
  };
  const view = render(<NoteEditor doc={initial} {...props} />);
  const rerender = (next: EditorDocument) => view.rerender(<NoteEditor doc={next} {...props} />);
  return { editComment, rerender, unmount: view.unmount };
}

const fields = () => screen.queryAllByRole('textbox', { name: 'Comment on this highlight' });
const field = () => fields()[0] as HTMLTextAreaElement;

/** Every comment the person's words could be in now: a field on screen, or a write asked for. */
const keptOrWritten = (editComment: ReturnType<typeof renderNote>['editComment']) => [
  ...fields().map((each) => (each as HTMLTextAreaElement).value),
  ...editComment.mock.calls.map(([edit]) => edit.comment),
];

describe('a comment being typed', () => {
  it('is not lost when the note is read again with that highlight changed (a Kindle sync, an edit in Obsidian)', async () => {
    const { editComment, rerender } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    act(() => {
      field().focus();
      fireEvent.change(field(), { target: { value: 'Typed, not yet left.' } });
    });
    // The sync adds the follow-up note the person typed on the Kindle.
    rerender(lamp('Lit by Mara.\n>\n> From the Kindle.'));
    // Drawn again from the new bytes (the premise): the field is back on screen.
    await waitFor(() => expect(fields()).toHaveLength(1));
    expect(keptOrWritten(editComment)).toContain('Typed, not yet left.');
  });

  it('is not lost when the note closes before the field is left', async () => {
    const { editComment, unmount } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    act(() => {
      field().focus();
      fireEvent.change(field(), { target: { value: 'Typed, then ⌘W.' } });
    });
    unmount();
    expect(editComment.mock.calls.map(([edit]) => edit.comment)).toContain('Typed, then ⌘W.');
  });

  it('keeps what was typed when Escape only cancels an input method’s composition', async () => {
    const { editComment } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    act(() => {
      field().focus();
      fireEvent.change(field(), { target: { value: 'Mara に' } });
      // Escape pressed mid-composition (Japanese, Chinese): it cancels the candidate, nothing more.
      fireEvent.keyDown(field(), { key: 'Escape', isComposing: true, keyCode: 229 });
    });
    expect(keptOrWritten(editComment)).toContain('Mara に');
  });
});

describe('undo after a comment was written', () => {
  it('does not put the old comment back', async () => {
    const { rerender } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
      .editor;
    act(() => {
      editor.chain().focus('end').insertContent(' More.').run();
    });
    // The comment is written and the note read again, as the pane does after the write.
    rerender(lamp('Written by the note.'));
    await waitFor(() => expect(field().value).toBe('Written by the note.'));
    act(() => {
      editor.commands.undo();
      editor.commands.undo();
    });
    const comments: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'rawBlock') comments.push(String(node.attrs['markdown']));
    });
    expect(comments.join('\n')).toContain('Written by the note.');
  });
});

describe('a comment field, for a person using a screen reader', () => {
  it('says which highlight each comment belongs to', async () => {
    renderNote(
      doc(
        { type: 'rawBlock', attrs: { markdown: block('The last lamp.', ''), anchor: 'k3x9q2' } },
        { type: 'rawBlock', attrs: { markdown: block('Gulls argue.', ''), anchor: 'k3x9q3' } },
      ),
    );
    await screen.findByText('Gulls argue.');
    const described = fields().map(
      (each) => `${each.getAttribute('aria-label')} ${each.getAttribute('aria-describedby') ?? ''}`,
    );
    expect(new Set(described).size).toBe(2);
  });
});

describe('a literature note of 500 highlights', () => {
  it('redraws none of them while the person types in its prose', async () => {
    const many = doc(
      { type: 'paragraph', content: [{ type: 'text', text: 'My own words.' }] },
      ...Array.from({ length: 500 }, (_, at) => ({
        type: 'rawBlock',
        attrs: {
          markdown: block(`Passage ${at}.`, at % 2 === 0 ? `Comment ${at}.` : ''),
          anchor: `h${String(at).padStart(5, '0')}`,
        },
      })),
    );
    renderNote(many);
    await screen.findByText('Passage 499.');
    const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
      .editor;
    startCountingRenders();
    act(() => {
      for (const letter of 'abcdefghij') {
        editor
          .chain()
          .setTextSelection(1 + 'My own words.'.length)
          .insertContent(letter)
          .run();
      }
    });
    const counts = stopCountingRenders();
    expect(counts.renders['HighlightBlockView'] ?? 0).toBe(0);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import {
  HighlightCommentChangedError,
  type EditorDocument,
  type HighlightView,
} from '@dfai/domain';
import { NoteEditor, type NoteHighlights } from './note-editor.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

/*
 * Regression tests for PR #534 (#523): a highlight's comment typed in place.
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

function renderNote(
  initial: EditorDocument,
  given: {
    editComment?: NoteHighlights['editComment'];
    identity?: string;
    onUnwrittenComments?: NoteHighlights['onUnwrittenComments'];
  } = {},
) {
  const editComment = vi.fn<NoteHighlights['editComment']>(given.editComment ?? (async () => {}));
  const highlightsOf = (identity: string | undefined, write = editComment) => ({
    viewOf,
    editComment: write,
    ...(identity !== undefined && { identity }),
    ...(given.onUnwrittenComments !== undefined && {
      onUnwrittenComments: given.onUnwrittenComments,
    }),
  });
  const props = {
    onChange: vi.fn(),
    onFollowLink: vi.fn(),
    suggestNotes: () => [],
    loadImage: async () => null,
  };
  const view = render(
    <NoteEditor doc={initial} {...props} highlights={highlightsOf(given.identity)} />,
  );
  const rerender = (next: EditorDocument) =>
    view.rerender(<NoteEditor doc={next} {...props} highlights={highlightsOf(given.identity)} />);
  /** Another note takes this editor's place, with its own write. */
  const switchTo = (next: EditorDocument, identity: string, write: typeof editComment) =>
    view.rerender(<NoteEditor doc={next} {...props} highlights={highlightsOf(identity, write)} />);
  return { editComment, rerender, switchTo, unmount: view.unmount };
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

const type = (value: string) => {
  act(() => {
    field().focus();
    fireEvent.change(field(), { target: { value } });
  });
};

describe('a comment written over one that changed on disk meanwhile', () => {
  const refused = () =>
    vi.fn<NoteHighlights['editComment']>(async () => {
      throw new HighlightCommentChangedError('k3x9q2', 'Lit by Mara.\n\nFrom the Kindle.');
    });

  it('keeps what was typed and shows the comment now on the disk', async () => {
    const { editComment } = renderNote(lamp('Lit by Mara.'), { editComment: refused() });
    await screen.findByText('The last lamp.');
    type('Typed in DFAI.');
    act(() => {
      fireEvent.blur(field());
    });
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('From the Kindle.');
    expect(field().value).toBe('Typed in DFAI.');
    expect(editComment).toHaveBeenCalledWith({
      id: 'k3x9q2',
      comment: 'Typed in DFAI.',
      base: 'Lit by Mara.',
    });
  });

  it('writes again over the new comment when the person chooses "Use mine"', async () => {
    const write = refused();
    const { editComment } = renderNote(lamp('Lit by Mara.'), { editComment: write });
    await screen.findByText('The last lamp.');
    type('Typed in DFAI.');
    act(() => {
      fireEvent.blur(field());
    });
    await screen.findByRole('alert');
    write.mockImplementation(async () => {});
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Use mine' }));
    });
    await waitFor(() => expect(editComment).toHaveBeenCalledTimes(2));
    expect(editComment).toHaveBeenLastCalledWith({
      id: 'k3x9q2',
      comment: 'Typed in DFAI.',
      base: 'Lit by Mara.\n\nFrom the Kindle.',
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('puts the note\'s comment in the field when the person chooses "Keep theirs"', async () => {
    const { editComment } = renderNote(lamp('Lit by Mara.'), { editComment: refused() });
    await screen.findByText('The last lamp.');
    type('Typed in DFAI.');
    act(() => {
      fireEvent.blur(field());
    });
    await screen.findByRole('alert');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }));
    });
    expect(field().value).toBe('Lit by Mara.\n\nFrom the Kindle.');
    expect(editComment).toHaveBeenCalledTimes(1);
  });

  it('is not asked again on every blur while the person has not chosen', async () => {
    const { editComment } = renderNote(lamp('Lit by Mara.'), { editComment: refused() });
    await screen.findByText('The last lamp.');
    type('Typed in DFAI.');
    act(() => {
      fireEvent.blur(field());
    });
    await screen.findByRole('alert');
    act(() => {
      fireEvent.blur(field());
    });
    expect(editComment).toHaveBeenCalledTimes(1);
  });
});

describe('a comment being typed, when the note is read again', () => {
  it('is written over the comment it started from, not the one read since', async () => {
    const { editComment, rerender } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    type('Typed, not yet left.');
    rerender(lamp('Lit by Mara.\n>\n> From the Kindle.'));
    await waitFor(() => expect(field().value).toBe('Typed, not yet left.'));
    act(() => {
      fireEvent.blur(field());
    });
    await waitFor(() => expect(editComment).toHaveBeenCalledTimes(1));
    expect(editComment.mock.calls[0]?.[0].base).toBe('Lit by Mara.');
  });

  it('takes the new comment in a field the person had not typed in', async () => {
    const { rerender } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    rerender(lamp('Lit by Mara, at dusk.'));
    await waitFor(() => expect(field().value).toBe('Lit by Mara, at dusk.'));
  });

  it('keeps the person in the field they were in', async () => {
    const { rerender } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    type('Typed, not yet left.');
    expect(document.activeElement).toBe(field());
    rerender(lamp('Lit by Mara.\n>\n> From the Kindle.'));
    await waitFor(() => expect(field().value).toBe('Typed, not yet left.'));
    expect(document.activeElement).toBe(field());
  });
});

describe('a comment typed when the note closes or another takes its place', () => {
  it('is written to the note it was typed in, not the next one', async () => {
    const first = vi.fn<NoteHighlights['editComment']>(async () => {});
    const second = vi.fn<NoteHighlights['editComment']>(async () => {});
    const { switchTo } = renderNote(lamp('Lit by Mara.'), {
      editComment: first,
      identity: 'Library/Brightwater.md',
    });
    await screen.findByText('The last lamp.');
    type('Typed in the first.');
    switchTo(lamp('Another comment.'), 'Library/Lanterns.md', second);
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(first.mock.calls[0]?.[0]).toMatchObject({ comment: 'Typed in the first.' });
    expect(second).not.toHaveBeenCalled();
  });

  it('is told of, with the words, when it could not be written', async () => {
    const lost = vi.fn();
    const { unmount } = renderNote(lamp('Lit by Mara.'), {
      editComment: async () => {
        throw new Error('The note has unsaved typing.');
      },
      onUnwrittenComments: lost,
    });
    await screen.findByText('The last lamp.');
    type('Typed, then ⌘W.');
    unmount();
    await waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    expect(lost.mock.calls[0]?.[0]).toEqual([
      { id: 'k3x9q2', comment: 'Typed, then ⌘W.', why: 'The note has unsaved typing.' },
    ]);
  });

  it('writes nothing for a comment that was only looked at', async () => {
    const { editComment, unmount } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    unmount();
    expect(editComment).not.toHaveBeenCalled();
  });
});

describe('a comment field and an input method', () => {
  it('does not write on ⌘↩ pressed while a composition is open', async () => {
    const { editComment } = renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    type('Mara に');
    act(() => {
      fireEvent.keyDown(field(), { key: 'Enter', metaKey: true, isComposing: true, keyCode: 229 });
    });
    expect(editComment).not.toHaveBeenCalled();
  });

  it('puts the comment back on Escape when no composition is open', async () => {
    renderNote(lamp('Lit by Mara.'));
    await screen.findByText('The last lamp.');
    type('Changed.');
    act(() => {
      fireEvent.keyDown(field(), { key: 'Escape' });
    });
    expect(field().value).toBe('Lit by Mara.');
  });
});

describe('a highlight a comment in the note now hides', () => {
  it('is drawn as its source, with no change to the note to save', async () => {
    const editComment = vi.fn(async () => {});
    let reads = true;
    const reading = ({ markdown, id }: { markdown: string; id: string }) =>
      reads ? viewOf({ markdown, id }) : null;
    const props = {
      onChange: vi.fn(),
      onFollowLink: vi.fn(),
      suggestNotes: () => [],
      loadImage: async () => null,
    };
    const view = render(
      <NoteEditor
        doc={lamp('Lit by Mara.')}
        {...props}
        highlights={{ viewOf: reading, editComment }}
      />,
    );
    await screen.findByText('The last lamp.');
    expect(fields()).toHaveLength(1);
    reads = false;
    // The note is read again with the same bytes in this block: a `%%` above it hides it.
    view.rerender(
      <NoteEditor
        doc={lamp('Lit by Mara.')}
        {...props}
        highlights={{ viewOf: (block) => reading(block), editComment }}
      />,
    );
    await waitFor(() => expect(fields()).toHaveLength(0));
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

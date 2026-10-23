// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from '@tiptap/pm/view';
import {
  HighlightCommentChangedError,
  HighlightNotFoundError,
  type EditorDocument,
  type HighlightView,
} from '@dfai/domain';
import { NoteEditor, type NoteHighlights } from './note-editor.tsx';
import { READ_FROM_FILE } from './editor/block-anchor.ts';

/*
 * Verification pass on PR #534 after its fix round (head 510eced0): a comment
 * typed in a highlight's field, across a second change on disk while the
 * conflict notice is shown, and across a rename of the note under the pane.
 */

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
  given: { editComment: NoteHighlights['editComment']; identity?: string },
) {
  const props = {
    onChange: vi.fn(),
    onFollowLink: vi.fn(),
    suggestNotes: () => [],
    loadImage: async () => null,
  };
  const highlightsOf = (identity: string | undefined, write: NoteHighlights['editComment']) => ({
    viewOf,
    editComment: write,
    ...(identity !== undefined && { identity }),
  });
  const view = render(
    <NoteEditor
      doc={initial}
      {...props}
      highlights={highlightsOf(given.identity, given.editComment)}
    />,
  );
  const show = (
    next: EditorDocument,
    identity: string | undefined,
    write: NoteHighlights['editComment'],
  ) =>
    view.rerender(<NoteEditor doc={next} {...props} highlights={highlightsOf(identity, write)} />);
  return { show, props };
}

const fields = () => screen.queryAllByRole('textbox', { name: 'Comment on this highlight' });
const field = () => fields()[0] as HTMLTextAreaElement;
const type = (text: string) =>
  act(() => {
    field().focus();
    fireEvent.change(field(), { target: { value: text } });
  });

describe('a conflict notice, when the comment changes on disk again while it is shown', () => {
  it('"Keep theirs" puts the comment now on disk in the field, not the one the first refusal saw', async () => {
    const refused = vi.fn<NoteHighlights['editComment']>(async () => {
      throw new HighlightCommentChangedError('k3x9q2', 'From the Kindle.');
    });
    const { show } = renderNote(lamp('Lit by Mara.'), { editComment: refused });
    await screen.findByText('The last lamp.');
    type('Typed in DFAI.');
    act(() => {
      fireEvent.blur(field());
    });
    await screen.findByRole('alert');
    // The note is read again: the sync wrote the comment once more, then Obsidian changed it.
    show(lamp('From the Kindle.'), undefined, refused);
    show(lamp('Edited in Obsidian.'), undefined, refused);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }));
    });
    expect(field().value).toBe('Edited in Obsidian.');
  });
});

describe('a comment being typed, when the note is renamed under the pane', () => {
  /** Types in the field, then moves the note: the pane keeps its editor across a move (usePageKey). */
  async function typeThenRename() {
    // The old path is gone after the move: a write to it finds no note.
    const toOldPath = vi.fn<NoteHighlights['editComment']>(async () => {
      throw new HighlightNotFoundError('k3x9q2');
    });
    const toNewPath = vi.fn<NoteHighlights['editComment']>(async () => {});
    const { show } = renderNote(lamp('Lit by Mara.'), {
      editComment: toOldPath,
      identity: 'Library/Brightwater.md',
    });
    await screen.findByText('The last lamp.');
    type('Typed, not yet left.');
    show(lamp('Lit by Mara.'), 'Library/Read/Brightwater.md', toNewPath);
    // Whatever the move set off is let settle before the note is read again.
    await act(async () => {
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    });
    // Drawn again, as the re-read after the move draws it.
    show(lamp('Lit by Mara.'), 'Library/Read/Brightwater.md', toNewPath);
    return { toOldPath, toNewPath };
  }

  it('is not written to the path the note was moved away from', async () => {
    const { toOldPath } = await typeThenRename();
    expect(toOldPath).not.toHaveBeenCalled();
  });

  it('stays in the field the person goes on typing in', async () => {
    await typeThenRename();
    // The person had not stopped typing: the next key lands in the same field.
    act(() => {
      fireEvent.change(field(), { target: { value: 'Typed, not yet left. More' } });
    });
    expect(field().value).toBe('Typed, not yet left. More');
  });
});

describe('a literature note, when it is opened', () => {
  it('draws each highlight once: no block is changed and changed back to draw it again', async () => {
    const MARKS = 5;
    const content = Array.from({ length: MARKS }, (_, at) => ({
      type: 'rawBlock',
      attrs: { markdown: block(`Passage ${at + 1}.`, ''), anchor: `h${at}` },
    }));
    // The redraw's steps are the editor's only non-history reads from file of a note already open.
    const redrawn: number[] = [];
    const dispatch = EditorView.prototype.dispatch;
    const spy = vi.spyOn(EditorView.prototype, 'dispatch').mockImplementation(function (
      this: EditorView,
      tr,
    ) {
      if (tr.getMeta(READ_FROM_FILE) === true && tr.getMeta('addToHistory') === false) {
        redrawn.push(tr.steps.length);
      }
      dispatch.call(this, tr);
    });
    try {
      renderNote(doc(...content), { editComment: async () => {} });
      await screen.findByText(`Passage ${MARKS}.`);
      await act(async () => {
        for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
      });
      expect(fields()).toHaveLength(MARKS);
      expect(redrawn).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

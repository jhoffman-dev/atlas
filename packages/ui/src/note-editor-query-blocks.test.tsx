// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { Slice } from '@tiptap/pm/model';
import type { BoardRow, EditorDocument, EditorNode, VaultPath } from '@atlas/domain';
import { NoteEditor, type NoteQueryBlocks } from './note-editor.tsx';
import type { QueryBlockShown } from './editor/query-block.tsx';

/**
 * A query block in a note (P30-05): the answer to its query drawn in place,
 * as a table or a list, read-only, asked again whenever the index changes;
 * its problems said in words; its text edited behind "Edit query", where
 * each change is the note's and is asked about once typing pauses.
 */

afterEach(cleanup);

beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  Element.prototype.scrollIntoView = () => {};
});

const QUERY = 'FROM meeting WHERE people = this';
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });
const queryBlock = (text: string): EditorNode => ({ type: 'queryBlock', attrs: { text } });
const paragraph = (value: string): EditorNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
});

const row = (title: string, date: string): BoardRow => ({
  path: `meetings/${title}.md` as VaultPath,
  title,
  values: { date },
});

function rowsOf(
  layout: 'table' | 'list',
  rows: readonly BoardRow[],
  truncated = false,
): QueryBlockShown {
  return {
    kind: 'rows',
    result: { layout, fields: [{ key: 'date', label: 'Date' }], rows, groups: [] },
    truncated,
  };
}

const KICKOFF = rowsOf('table', [row('Kickoff', '2026-10-01'), row('Review', '2026-10-06')]);

function renderEditor(initial: EditorDocument, queries?: NoteQueryBlocks) {
  const onChange = vi.fn<(changed: EditorDocument) => void>();
  const view = (current: NoteQueryBlocks | undefined) => (
    <NoteEditor
      doc={initial}
      onChange={onChange}
      onFollowLink={() => {}}
      suggestNotes={() => []}
      loadImage={async () => null}
      {...(current !== undefined && { queries: current })}
    />
  );
  const rendered = render(view(queries));
  return {
    ...rendered,
    lastDoc: () => onChange.mock.lastCall?.[0],
    rerenderWith: (next: NoteQueryBlocks) => rendered.rerender(view(next)),
  };
}

function answering(
  answer: (text: string) => Promise<QueryBlockShown>,
  revision: unknown = 0,
): NoteQueryBlocks & { run: ReturnType<typeof vi.fn<(text: string) => Promise<QueryBlockShown>>> } {
  return { run: vi.fn(answer), onOpenNote: vi.fn(), revision };
}

async function editorIn(container: HTMLElement): Promise<Editor> {
  const element = await waitFor(() => {
    const found = container.querySelector('.ProseMirror');
    if (found === null) throw new Error('no editor yet');
    return found;
  });
  return (element as HTMLElement & { editor: Editor }).editor;
}

const block = () => screen.findByRole('group', { name: 'Query block' });

describe('a query block draws its answer', () => {
  it('as a table of the rows, each opening its note, with how many there are', async () => {
    const queries = answering(async () => KICKOFF);
    renderEditor(doc(paragraph('Meetings.'), queryBlock(QUERY)), queries);
    const shown = await block();
    const table = await within(shown).findByRole('table');
    expect(
      within(table)
        .getAllByRole('row')
        .map((line) => line.textContent),
    ).toEqual(['NameDate', 'Kickoff2026-10-01', 'Review2026-10-06']);
    expect(within(shown).getByRole('status').textContent).toContain('2 notes');
    expect(queries.run).toHaveBeenCalledWith(QUERY);

    fireEvent.click(within(table).getByRole('button', { name: 'Review' }));
    expect(queries.onOpenNote).toHaveBeenCalledWith('meetings/Review.md');
  });

  it('as a list when its answer says so', async () => {
    renderEditor(
      doc(queryBlock(`layout: list\n${QUERY}`)),
      answering(async () => rowsOf('list', [row('Kickoff', '2026-10-01')])),
    );
    const shown = await block();
    const list = await within(shown).findByRole('list', { name: 'Notes' });
    expect(list.textContent).toContain('Kickoff2026-10-01');
    expect(within(shown).queryByRole('table')).toBeNull();
  });

  it('says when more notes matched than were drawn', async () => {
    renderEditor(
      doc(queryBlock(QUERY)),
      answering(async () => rowsOf('table', [row('Kickoff', '2026-10-01')], true)),
    );
    const shown = await block();
    await waitFor(() =>
      expect(within(shown).getByRole('status').textContent).toContain(
        '1 note (more were left out)',
      ),
    );
  });

  it('says a problem in its query, in words', async () => {
    renderEditor(
      doc(queryBlock('FROM meeting WHERE stauts = x')),
      answering(async () => ({
        kind: 'problem',
        message: 'A meeting has no field called stauts.',
      })),
    );
    const shown = await block();
    expect((await within(shown).findByRole('alert')).textContent).toContain(
      'A meeting has no field called stauts.',
    );
    expect(within(shown).queryByRole('table')).toBeNull();
  });

  it('says when it could not be asked at all', async () => {
    renderEditor(
      doc(queryBlock(QUERY)),
      answering(() => Promise.reject(new Error('gone'))),
    );
    const shown = await block();
    expect((await within(shown).findByRole('alert')).textContent).toContain(
      'This query could not be run just now.',
    );
  });

  it('is asked again when the index changes, and shows the new answer', async () => {
    let answer = KICKOFF;
    const queries = answering(async () => answer);
    const rendered = renderEditor(doc(queryBlock(QUERY)), queries);
    const shown = await block();
    await within(shown).findByRole('button', { name: 'Kickoff' });
    const asked = queries.run.mock.calls.length;

    answer = rowsOf('table', [row('Retro', '2026-10-07')]);
    rendered.rerenderWith({ ...queries, revision: 1 });
    await within(shown).findByRole('button', { name: 'Retro' });
    expect(queries.run.mock.calls.length).toBe(asked + 1);
    expect(within(shown).queryByRole('button', { name: 'Kickoff' })).toBeNull();
  });

  it('is drawn as its code where nothing answers it, and runs nothing', async () => {
    const rendered = renderEditor(doc(queryBlock(QUERY)));
    await editorIn(rendered.container);
    const code = rendered.container.querySelector('pre[data-query-block] code');
    expect(code?.textContent).toBe(QUERY);
    expect(screen.queryByRole('group', { name: 'Query block' })).toBeNull();
  });
});

describe('editing a query block’s text', () => {
  it('is behind Edit query, and each change is the note’s and asks again', async () => {
    const queries = answering(async (text) =>
      text.includes('Retro') ? rowsOf('table', [row('Retro', '2026-10-07')]) : KICKOFF,
    );
    const rendered = renderEditor(doc(queryBlock(QUERY)), queries);
    const shown = await block();
    await within(shown).findByRole('button', { name: 'Kickoff' });
    expect(within(shown).queryByRole('textbox', { name: 'Query text' })).toBeNull();

    fireEvent.click(within(shown).getByRole('button', { name: 'Edit query' }));
    const field = within(shown).getByRole('textbox', { name: 'Query text' });
    expect((field as HTMLTextAreaElement).value).toBe(QUERY);
    const edited = "FROM meeting WHERE title = 'Retro'";
    fireEvent.change(field, { target: { value: edited } });

    const saved = rendered.lastDoc()?.content.filter((node) => node.type === 'queryBlock');
    expect(saved?.map((node) => node.attrs?.['text'])).toEqual([edited]);
    await within(shown).findByRole('button', { name: 'Retro' });
    expect(queries.run).toHaveBeenLastCalledWith(edited);

    fireEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(within(shown).queryByRole('textbox', { name: 'Query text' })).toBeNull();
  });

  it('asks once typing pauses, not at every keystroke', async () => {
    const queries = answering(async () => KICKOFF);
    renderEditor(doc(queryBlock(QUERY)), queries);
    const shown = await block();
    await within(shown).findByRole('button', { name: 'Kickoff' });
    fireEvent.click(within(shown).getByRole('button', { name: 'Edit query' }));
    const field = within(shown).getByRole('textbox', { name: 'Query text' });
    const before = queries.run.mock.calls.length;
    vi.useFakeTimers();
    try {
      for (const typed of ['FROM m', 'FROM me', 'FROM mee']) {
        fireEvent.change(field, { target: { value: typed } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
      }
      expect((field as HTMLTextAreaElement).value).toBe('FROM mee');
      expect(queries.run.mock.calls.length).toBe(before);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(queries.run.mock.calls.slice(before)).toEqual([['FROM mee']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens at its text when it has none yet', async () => {
    renderEditor(
      doc(queryBlock('')),
      answering(async () => ({ kind: 'problem', message: 'This query block has no query yet.' })),
    );
    const shown = await block();
    expect(
      (within(shown).getByRole('textbox', { name: 'Query text' }) as HTMLTextAreaElement).value,
    ).toBe('');
    within(shown).getByRole('button', { name: 'Done' });
  });
});

describe('the Query slash command', () => {
  it('makes an empty query block, open at its text, where the note can answer one', async () => {
    const queries = answering(async () => ({ kind: 'problem', message: 'No query yet.' }));
    const rendered = renderEditor(doc({ type: 'paragraph' }), queries);
    const editor = await editorIn(rendered.container);
    act(() => {
      editor.commands.focus('end');
      editor.view.dispatch(editor.state.tr.insertText('/query'));
    });
    const commands = await screen.findByRole('listbox', { name: 'Insert block' });
    fireEvent.mouseDown(within(commands).getByRole('option', { name: /^Query/ }));
    const shown = await block();
    expect(
      (within(shown).getByRole('textbox', { name: 'Query text' }) as HTMLTextAreaElement).value,
    ).toBe('');
    expect(rendered.lastDoc()?.content.map((node) => node.type)).toContain('queryBlock');
  });

  it('is not offered where nothing could answer the block', async () => {
    const rendered = renderEditor(doc({ type: 'paragraph' }));
    const editor = await editorIn(rendered.container);
    act(() => {
      editor.commands.focus('end');
      editor.view.dispatch(editor.state.tr.insertText('/'));
    });
    const commands = await screen.findByRole('listbox', { name: 'Insert block' });
    expect(within(commands).getAllByRole('option').length).toBeGreaterThan(0);
    expect(within(commands).queryByRole('option', { name: /^Query/ })).toBeNull();
  });
});

describe('a query block copied and pasted (adversarial)', () => {
  /** The clipboard ProseMirror writes for the selected query block, as copy and cut write it. */
  async function copiedBlock(rendered: ReturnType<typeof renderEditor>) {
    const editor = await editorIn(rendered.container);
    let at = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'queryBlock') at = offset;
    });
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)),
      );
    });
    const clipboard = (
      editor.view as unknown as {
        serializeForClipboard: (slice: Slice) => { dom: HTMLElement; text: string };
      }
    ).serializeForClipboard(editor.state.selection.content());
    return { editor, html: clipboard.dom.innerHTML, text: clipboard.text };
  }

  /** Where to type in the list item's empty paragraph. */
  function insideTheListItem(editor: Editor): number {
    let at = -1;
    editor.state.doc.descendants((node, pos, parent) => {
      const empty = node.type.name === 'paragraph' && node.childCount === 0;
      if (empty && parent?.type.name === 'listItem') at = pos + 1;
    });
    return at;
  }

  const pasteEvent = () =>
    Object.assign(new Event('paste'), {
      clipboardData: { types: [], files: [], items: [], getData: () => '' },
    }) as unknown as ClipboardEvent;

  it('pasted among the note’s own blocks is the query block it was, not a code block with no language', async () => {
    const text = `layout: list\n${QUERY}`;
    const rendered = renderEditor(
      doc(paragraph('Meetings.'), queryBlock(text), { type: 'paragraph' }),
      answering(async () => KICKOFF),
    );
    const { editor, html } = await copiedBlock(rendered);
    act(() => {
      editor.commands.focus('end');
      editor.view.pasteHTML(html, pasteEvent());
    });
    const blocks = editor.getJSON().content ?? [];
    expect(blocks.filter((node) => node.type === 'codeBlock')).toEqual([]);
    expect(
      blocks.filter((node) => node.type === 'queryBlock').map((node) => node.attrs?.['text']),
    ).toEqual([text, text]);
  });

  it('pasted into a list item is the atlas-query code block it is there', async () => {
    const list: EditorNode = {
      type: 'bulletList',
      // An item begins with a paragraph, so the paste goes in the empty one after it.
      content: [{ type: 'listItem', content: [paragraph('Agenda'), { type: 'paragraph' }] }],
    };
    const rendered = renderEditor(
      doc(queryBlock(QUERY), list),
      answering(async () => KICKOFF),
    );
    const { editor, html } = await copiedBlock(rendered);
    act(() => {
      editor.commands.focus();
      editor.commands.setTextSelection(insideTheListItem(editor));
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(editor.state.selection.$from.depth).toBe(3);
      editor.view.pasteHTML(html, pasteEvent());
    });
    const pasted = editor.getJSON() as EditorDocument;
    const item = pasted.content[1]?.content?.[0]?.content ?? [];
    expect(item[0]).toMatchObject({ type: 'paragraph', content: [{ text: 'Agenda' }] });
    expect(item.filter((node) => node.type === 'codeBlock')).toEqual([
      {
        type: 'codeBlock',
        attrs: expect.objectContaining({ language: 'atlas-query' }),
        content: [{ type: 'text', text: QUERY }],
      },
    ]);
    expect(editor.getJSON().content?.filter((node) => node.type === 'queryBlock')).toHaveLength(1);
  });

  it('copied as plain text is its fence’s text, not nothing', async () => {
    const rendered = renderEditor(doc(paragraph('Meetings.'), queryBlock(QUERY)));
    const { text } = await copiedBlock(rendered);
    expect(text).toContain(QUERY);
  });
});

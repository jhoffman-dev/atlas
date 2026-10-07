// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorDocument, EditorNode, NoteSuggestion, WikiLink } from '@atlas/domain';
import { NoteEditor, type NoteBookmarks } from './note-editor.tsx';
import type { BookmarkPreview } from './bookmark-card.tsx';

/**
 * Bookmarks in a note (P22-01, P22-02): a card drawn from the note it links
 * to, opened by a click or Enter, and switched to a link and back from the
 * link's menu — its "…", a right-click or Shift+F10 — or picked as a card
 * straight from `[[` with Shift+Enter.
 */

afterEach(cleanup);

// jsdom measures no text: a switch scrolls the caret into view, which asks a range for its boxes.
beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
});

const link = (target: string): EditorNode => ({
  type: 'wikiLink',
  attrs: { target, heading: null, alias: null },
});
const text = (value: string): EditorNode => ({ type: 'text', text: value });
const bookmark = (target: string): EditorNode => ({
  type: 'bookmark',
  attrs: { target, heading: null, alias: null },
});
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

const ROME: BookmarkPreview = {
  kind: 'note',
  title: 'Rome in May',
  summary: 'Ten days, three cities.',
  place: 'Trips',
  archived: false,
  picture: null,
};

async function editorIn(container: HTMLElement): Promise<Editor> {
  const element = await waitFor(() => {
    const found = container.querySelector('.ProseMirror');
    if (found === null) throw new Error('no editor yet');
    return found;
  });
  return (element as HTMLElement & { editor: Editor }).editor;
}

function renderEditor(
  initial: EditorDocument,
  {
    bookmarks = { load: async () => ROME, revision: 0 },
    suggestNotes = () => [],
  }: {
    bookmarks?: NoteBookmarks;
    suggestNotes?: (query: string) => NoteSuggestion[];
  } = {},
) {
  const onChange = vi.fn<(changed: EditorDocument) => void>();
  const onFollowLink = vi.fn<(target: string) => void>();
  const view = (current: NoteBookmarks) => (
    <NoteEditor
      doc={initial}
      onChange={onChange}
      onFollowLink={onFollowLink}
      suggestNotes={suggestNotes}
      loadImage={async () => null}
      bookmarks={current}
    />
  );
  const rendered = render(view(bookmarks));
  const lastDoc = () => onChange.mock.lastCall?.[0];
  return {
    ...rendered,
    onChange,
    onFollowLink,
    lastDoc,
    rerenderWith: (next: NoteBookmarks) => rendered.rerender(view(next)),
  };
}

/** The top-level blocks of a document, without their block ids, as types and links. */
const shape = (changed: EditorDocument | undefined) =>
  changed?.content.map((node) =>
    node.type === 'bookmark'
      ? `bookmark:${String(node.attrs?.['target'])}`
      : `${node.type}:${(node.content ?? []).map((child) => child.text ?? `[[${String(child.attrs?.['target'])}]]`).join('')}`,
  );

function press(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) === true;
}

describe('a bookmark in a note', () => {
  it('is drawn as a card of the note it links to', async () => {
    const load = vi.fn<(link: WikiLink) => Promise<BookmarkPreview>>(async () => ROME);
    renderEditor(doc(bookmark('Rome')), { bookmarks: { load, revision: 0 } });
    const card = await screen.findByRole('group', { name: 'Bookmark: Rome in May' });
    expect(card.textContent).toContain('Ten days, three cities.');
    expect(card.textContent).toContain('Trips');
    expect(load).toHaveBeenCalledWith({ target: 'Rome', heading: null, alias: null });
  });

  it('says so when the link names no note', async () => {
    renderEditor(doc(bookmark('Paris')), {
      bookmarks: { load: async () => ({ kind: 'missing', label: 'Paris' }), revision: 0 },
    });
    const card = await screen.findByRole('group', { name: 'Bookmark: Paris' });
    await waitFor(() => expect(card.className).toContain('bookmark--missing'));
    expect(card.textContent).toContain('No note is called “Paris”');
  });

  it('is read again when the page says notes have changed', async () => {
    let summary = 'First.';
    const load = vi.fn(async () => ({ ...ROME, summary }));
    const { rerenderWith } = renderEditor(doc(bookmark('Rome')), {
      bookmarks: { load, revision: 1 },
    });
    await screen.findByText('First.');
    summary = 'Second.';
    rerenderWith({ load, revision: 2 });
    await screen.findByText('Second.');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('opens its note on a click, but not on its "…"', async () => {
    const { onFollowLink } = renderEditor(doc(bookmark('Rome')));
    const card = await screen.findByRole('group', { name: 'Bookmark: Rome in May' });
    fireEvent.click(screen.getByRole('button', { name: 'Options for Rome in May' }));
    expect(onFollowLink).not.toHaveBeenCalled();
    fireEvent.click(card);
    expect(onFollowLink).toHaveBeenCalledWith('Rome');
  });

  // A22-01's decision: Enter on a card does what Enter does everywhere else in
  // a note — a new line after it — and Mod-Enter opens it, as it opens a link.
  it('opens its note on Mod-Enter once selected', async () => {
    const { container, onFollowLink } = renderEditor(
      doc({ type: 'paragraph', content: [text('Before')] }, bookmark('Rome')),
    );
    const editor = await editorIn(container);
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 8)));
    });
    // Mod is Cmd on a Mac and Ctrl elsewhere, as ProseMirror reads the platform.
    const mod = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
      ? { metaKey: true }
      : { ctrlKey: true };
    expect(press(editor, 'Enter', mod)).toBe(true);
    expect(onFollowLink).toHaveBeenCalledWith('Rome');
  });

  it('starts a paragraph after a selected card on Enter, and does not open it', async () => {
    const { container, onFollowLink, lastDoc } = renderEditor(
      doc(bookmark('Rome'), { type: 'paragraph', content: [text('After')] }),
    );
    const editor = await editorIn(container);
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    });
    act(() => {
      expect(press(editor, 'Enter')).toBe(true);
    });
    expect(onFollowLink).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(shape(lastDoc())).toEqual(['bookmark:Rome', 'paragraph:', 'paragraph:After']),
    );
    // The caret is in the new paragraph, ready to type.
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.index(0)).toBe(1);
  });

  it('leaves Enter to the editor when no bookmark is selected', async () => {
    const { container, onFollowLink } = renderEditor(
      doc({ type: 'paragraph', content: [text('Before')] }),
    );
    const editor = await editorIn(container);
    act(() => {
      editor.commands.setTextSelection(3);
    });
    press(editor, 'Enter');
    expect(onFollowLink).not.toHaveBeenCalled();
  });
});

describe('switching a link between a link and a bookmark', () => {
  it('shows a link in a sentence as a bookmark, from its right-click menu', async () => {
    const { container, lastDoc } = renderEditor(
      doc({ type: 'paragraph', content: [text('See '), link('Rome'), text(' for days.')] }),
    );
    await editorIn(container);
    fireEvent.contextMenu(container.querySelector('[data-wikilink="Rome"]')!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Show as bookmark' }));
    await waitFor(() =>
      expect(shape(lastDoc())).toEqual(['paragraph:See', 'bookmark:Rome', 'paragraph:for days.']),
    );
  });

  it('shows a bookmark as a link again, from the "…" on its card', async () => {
    const { lastDoc } = renderEditor(
      doc(bookmark('Rome'), { type: 'paragraph', content: [text('After')] }),
    );
    await screen.findByRole('group', { name: 'Bookmark: Rome in May' });
    fireEvent.click(screen.getByRole('button', { name: 'Options for Rome in May' }));
    expect(screen.queryByRole('menuitem', { name: 'Show as bookmark' })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Show as link' }));
    await waitFor(() =>
      expect(shape(lastDoc())).toEqual(['paragraph:[[Rome]]', 'paragraph:After']),
    );
  });

  it('offers the "…" over a link under the pointer, which opens the same menu', async () => {
    const { container } = renderEditor(doc({ type: 'paragraph', content: [link('Rome')] }));
    await editorIn(container);
    expect(screen.queryByRole('button', { name: 'Link options' })).toBeNull();
    fireEvent.mouseOver(container.querySelector('[data-wikilink="Rome"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Link options' }));
    expect(await screen.findByRole('menuitem', { name: 'Show as bookmark' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open note' })).toBeTruthy();
  });

  it('opens the menu from the keyboard with the caret on the link', async () => {
    const { container } = renderEditor(
      doc({ type: 'paragraph', content: [text('See '), link('Rome')] }),
    );
    const editor = await editorIn(container);
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    });
    act(() => {
      expect(press(editor, 'F10', { shiftKey: true })).toBe(true);
    });
    expect(await screen.findByRole('menuitem', { name: 'Show as bookmark' })).toBeTruthy();
  });

  it('does not open a menu from the keyboard with the caret away from a link', async () => {
    const { container } = renderEditor(
      doc({ type: 'paragraph', content: [text('Plain words '), link('Rome')] }),
    );
    const editor = await editorIn(container);
    act(() => {
      editor.commands.setTextSelection(3);
    });
    expect(press(editor, 'F10', { shiftKey: true })).toBe(false);
  });

  it('does not offer a bookmark for a link inside a list, where a card cannot go', async () => {
    const { container } = renderEditor(
      doc({
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [link('Rome')] }] }],
      }),
    );
    await editorIn(container);
    fireEvent.contextMenu(container.querySelector('[data-wikilink="Rome"]')!);
    expect(await screen.findByRole('menuitem', { name: 'Open note' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Show as bookmark' })).toBeNull();
  });

  it('opens the note from the menu', async () => {
    const { container, onFollowLink } = renderEditor(
      doc({ type: 'paragraph', content: [link('Rome')] }),
    );
    await editorIn(container);
    fireEvent.contextMenu(container.querySelector('[data-wikilink="Rome"]')!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open note' }));
    expect(onFollowLink).toHaveBeenCalledWith('Rome');
  });
});

describe('picking a note from [[ as a bookmark', () => {
  const ROME_NOTE: NoteSuggestion = { path: 'Trips/Rome.md', target: 'Rome' } as NoteSuggestion;

  async function typedLink() {
    const rendered = renderEditor(doc({ type: 'paragraph' }), { suggestNotes: () => [ROME_NOTE] });
    const editor = await editorIn(rendered.container);
    act(() => {
      editor.commands.focus();
      for (const char of '[[Ro') {
        const { from, to } = editor.state.selection;
        editor.view.dispatch(editor.state.tr.insertText(char, from, to));
      }
    });
    await screen.findByRole('listbox', { name: 'Link to note' });
    return { ...rendered, editor };
  }

  it('says Shift+Enter makes a bookmark, along the foot of the list', async () => {
    await typedLink();
    const listbox = screen.getByRole('listbox', { name: 'Link to note' });
    expect(listbox.querySelector('.suggestions__hints')?.textContent).toContain('Bookmark');
  });

  it('puts the link in as a bookmark on Shift+Enter', async () => {
    const { editor, lastDoc } = await typedLink();
    act(() => {
      expect(press(editor, 'Enter', { shiftKey: true })).toBe(true);
    });
    await waitFor(() => expect(shape(lastDoc())).toEqual(['bookmark:Rome', 'paragraph:']));
  });

  it('puts it in as a link on Enter, as before', async () => {
    const { editor, lastDoc } = await typedLink();
    act(() => {
      expect(press(editor, 'Enter')).toBe(true);
    });
    await waitFor(() => expect(shape(lastDoc())).toEqual(['paragraph:[[Rome]] ']));
  });

  it('puts it in as a bookmark on a Shift-click', async () => {
    const { lastDoc } = await typedLink();
    fireEvent.mouseDown(screen.getByRole('option', { name: /Rome/ }), { shiftKey: true });
    await waitFor(() => expect(shape(lastDoc())).toEqual(['bookmark:Rome', 'paragraph:']));
  });
});

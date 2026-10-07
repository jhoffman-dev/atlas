// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import {
  blockAnchorsOf,
  type EditorDocument,
  type EditorNode,
  type Transclusion,
  type VaultPath,
} from '@atlas/domain';
import { NoteEditor, type NoteTransclusions } from './note-editor.tsx';
import type { BlockPicking } from './editor/block-picking.ts';

/*
 * A26-01 in the editor. Untouched text wins: an id the file holds twice is
 * left as the file has it unless the block holding it is the one changed.
 * An id follows its block whatever kind it becomes. A shown block is drawn
 * again only when what it shows has changed.
 */

afterEach(cleanup);

beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  Element.prototype.scrollIntoView = () => {};
});

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string, anchor?: string): EditorNode => ({
  type: 'paragraph',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [text(value)],
});
const item = (value: string, anchor?: string): EditorNode => ({
  type: 'listItem',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [paragraph(value)],
});
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

const picking: BlockPicking = {
  choicesFor: async () => null,
  anchor: async () => 'n3w1d2',
  newId: () => 'own123',
  onRefused: () => {},
};

const unused: NoteTransclusions = {
  load: async () => Promise.reject(new Error('unused')),
  loadImage: async () => null,
  revision: 0,
};

function view(initial: EditorDocument, transclusions: NoteTransclusions, onChange = vi.fn()) {
  return (
    <NoteEditor
      doc={initial}
      onChange={onChange}
      onFollowLink={() => {}}
      suggestNotes={() => []}
      loadImage={async () => null}
      picking={picking}
      transclusions={transclusions}
    />
  );
}

async function renderEditor(initial: EditorDocument, transclusions: NoteTransclusions = unused) {
  const onChange = vi.fn<(changed: EditorDocument) => void>();
  const rendered = render(view(initial, transclusions, onChange));
  const element = await waitFor(() => {
    const found = rendered.container.querySelector('.ProseMirror');
    if (found === null) throw new Error('no editor yet');
    return found;
  });
  const editor = (element as HTMLElement & { editor: Editor }).editor;
  return { editor, onChange, rendered };
}

/**
 * Every id the writer puts in the file, block by block — each block with a
 * place for one; the empty line the editor keeps at the end has none.
 */
const writableIds = (changed: EditorDocument): (string | null)[][] =>
  changed.content.map((block) => blockAnchorsOf(block)).filter((ids) => ids.length > 0);

/** Where the first character of `words` is. */
function positionOf(editor: Editor, words: string): number {
  let at = -1;
  editor.state.doc.descendants((node, position) => {
    if (at < 0 && node.isText && node.text === words) at = position;
  });
  if (at < 0) throw new Error(`no text ${words}`);
  return at;
}

describe('an id the file holds twice (untouched text wins)', () => {
  it('stays on both list items when another block is typed in', async () => {
    // `Intro\n\n- one ^a\n- two ^a`, as the reviewer found it.
    const list: EditorNode = { type: 'bulletList', content: [item('one', 'a'), item('two', 'a')] };
    const { editor, onChange } = await renderEditor(doc(paragraph('Intro'), list));
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('!', 6));
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const changed = onChange.mock.lastCall?.[0] as EditorDocument;
    expect(changed.content[0]?.content?.[0]?.text).toBe('Intro!');
    expect(writableIds(changed)).toEqual([[null], ['a', 'a', null]]);
  });

  it('stays on both blocks when the note is read again from its file', async () => {
    const { editor, rendered } = await renderEditor(doc(paragraph('Before')));
    const reread = doc(paragraph('First', 'dup'), paragraph('Second', 'dup'));
    rendered.rerender(view(reread, unused));
    await waitFor(() => expect(editor.state.doc.childCount).toBe(2));
    expect(writableIds(editor.getJSON() as EditorDocument)).toEqual([['dup'], ['dup']]);
  });
});

describe('an id follows its block whatever kind it becomes', () => {
  it('goes back to the paragraph when a list item is made a paragraph again', async () => {
    const list: EditorNode = { type: 'bulletList', content: [item('Pack the tent', 'i1')] };
    const { editor } = await renderEditor(doc(list));
    act(() => {
      editor.commands.setTextSelection(positionOf(editor, 'Pack the tent') + 2);
      editor.commands.toggleBulletList();
    });
    const changed = editor.getJSON() as EditorDocument;
    expect(changed.content[0]?.type).toBe('paragraph');
    expect(writableIds(changed)).toEqual([['i1']]);
  });

  it('is kept when a paragraph is made a heading, and when the heading is made a paragraph', async () => {
    const { editor } = await renderEditor(doc(paragraph('Plans', 'h1')));
    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.setHeading({ level: 2 });
    });
    let changed = editor.getJSON() as EditorDocument;
    expect(changed.content[0]?.type).toBe('heading');
    expect(writableIds(changed)).toEqual([['h1']]);
    act(() => {
      editor.commands.setParagraph();
    });
    changed = editor.getJSON() as EditorDocument;
    expect(changed.content[0]?.type).toBe('paragraph');
    expect(writableIds(changed)).toEqual([['h1']]);
  });

  it('goes back to the paragraph when a quote is lifted', async () => {
    const quote: EditorNode = {
      type: 'blockquote',
      attrs: { anchor: 'q1' },
      content: [paragraph('Said once')],
    };
    const { editor } = await renderEditor(doc(quote));
    act(() => {
      editor.commands.setTextSelection(positionOf(editor, 'Said once') + 2);
      editor.commands.toggleBlockquote();
    });
    const changed = editor.getJSON() as EditorDocument;
    expect(changed.content[0]?.type).toBe('paragraph');
    expect(writableIds(changed)).toEqual([['q1']]);
  });
});

describe('a shown block drawn again', () => {
  const PACK: Transclusion = {
    kind: 'block',
    path: 'Plans.md' as VaultPath,
    title: 'Plans',
    archived: false,
    fragment: { kind: 'block', id: 't1' },
    content: doc(paragraph('Pack the tent')),
  };
  const shownDoc = doc({
    type: 'blockEmbed',
    attrs: { target: 'Plans', heading: '#^t1', alias: null },
  });

  it('keeps what it drew when a change elsewhere reads the same block again', async () => {
    const load = vi.fn(async (): Promise<Transclusion> => ({
      ...PACK,
      content: doc(paragraph('Pack the tent')),
    }));
    const onChange = vi.fn();
    const rendered = render(
      view(shownDoc, { load, loadImage: async () => null, revision: 0 }, onChange),
    );
    const shown = await screen.findByRole('group', { name: 'Embedded block from Plans' });
    const body = await waitFor(() => {
      const found = shown.querySelector('.block-embed__body');
      if (found?.textContent !== 'Pack the tent') throw new Error('not drawn yet');
      return found as HTMLElement & { editor: Editor };
    });
    const redrawn = vi.fn();
    body.editor.on('transaction', redrawn);
    rendered.rerender(view(shownDoc, { load, loadImage: async () => null, revision: 1 }, onChange));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    // The second read settles on the next turns; it would be drawn then.
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 0));
    });
    expect(redrawn).not.toHaveBeenCalled();
    expect(body.textContent).toBe('Pack the tent');
  });
});

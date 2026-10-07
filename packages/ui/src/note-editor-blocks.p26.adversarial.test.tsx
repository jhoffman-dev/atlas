// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import {
  anchorsIn,
  blockAnchorsOf,
  type EditorDocument,
  type EditorNode,
  type OutlineEntry,
  type VaultPath,
} from '@atlas/domain';
import { NoteEditor } from './note-editor.tsx';
import type { BlockPicking } from './editor/block-picking.ts';

/*
 * Adversarial pass on P26-01 in the editor: what happens to an id when its
 * block changes kind, and when a note read from disk already holds one id
 * twice. The id's place in the file is `anchorPlaces` (ADR-0022); an id held
 * anywhere else is let go by the writer, so every embed of it breaks.
 */

afterEach(cleanup);

beforeAll(() => {
  const empty = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
  Element.prototype.scrollIntoView = () => {};
});

const paragraph = (value: string, anchor?: string): EditorNode => ({
  type: 'paragraph',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [{ type: 'text', text: value }],
});
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

const picking: BlockPicking = {
  choicesFor: async () => null,
  anchor: async () => 'n3w1d2',
  newId: () => 'own123',
  onRefused: () => {},
};

async function renderEditor(initial: EditorDocument, blocks: BlockPicking = picking) {
  const onChange = vi.fn<(changed: EditorDocument) => void>();
  const rendered = render(
    <NoteEditor
      doc={initial}
      onChange={onChange}
      onFollowLink={() => {}}
      suggestNotes={() => [{ path: 'Plans.md' as VaultPath, target: 'Plans' }]}
      loadImage={async () => null}
      picking={blocks}
      transclusions={{
        load: async () => Promise.reject(new Error('unused')),
        loadImage: async () => null,
        revision: 0,
      }}
    />,
  );
  const element = await waitFor(() => {
    const found = rendered.container.querySelector('.ProseMirror');
    if (found === null) throw new Error('no editor yet');
    return found;
  });
  return { editor: (element as HTMLElement & { editor: Editor }).editor, onChange };
}

/** Every id the writer can put in the file: those at `anchorPlaces` of each top-level block. */
const writableIds = (changed: EditorDocument): string[] =>
  changed.content.flatMap((block) =>
    blockAnchorsOf(block).filter((id): id is string => id !== null),
  );

describe('an id survives its block changing kind', () => {
  it('is still written when its paragraph is made a bullet list item', async () => {
    const { editor } = await renderEditor(doc(paragraph('Pack the tent', 'a1')));
    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.toggleBulletList();
    });
    const changed = editor.getJSON() as EditorDocument;
    expect(changed.content[0]?.type).toBe('bulletList');
    // The editor still holds it somewhere…
    expect([...anchorsIn(changed)]).toEqual(['a1']);
    // …but only on the item's inner paragraph, which has no place in the file.
    expect(writableIds(changed)).toEqual(['a1']);
  });

  it('is still written when its paragraph is made a task item', async () => {
    const { editor } = await renderEditor(doc(paragraph('Book the train', 'b2')));
    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.toggleTaskList();
    });
    const changed = editor.getJSON() as EditorDocument;
    expect(changed.content[0]?.type).toBe('taskList');
    expect(writableIds(changed)).toEqual(['b2']);
  });

  it('is still written when its paragraph is quoted', async () => {
    const { editor } = await renderEditor(doc(paragraph('Said once', 'q1')));
    act(() => {
      editor.commands.setTextSelection(3);
      editor.commands.toggleBlockquote();
    });
    const changed = editor.getJSON() as EditorDocument;
    expect(changed.content[0]?.type).toBe('blockquote');
    expect(writableIds(changed)).toEqual(['q1']);
  });
});

describe('a note read from disk that already holds one id twice', () => {
  it('keeps the untouched second block as it was on disk when another block is typed in', async () => {
    // `First ^dup\n\nSecond ^dup\n\nThird\n`, as Obsidian or a hand edit leaves it.
    const { editor, onChange } = await renderEditor(
      doc(paragraph('First', 'dup'), paragraph('Second', 'dup'), paragraph('Third')),
    );
    act(() => {
      editor.commands.focus('end');
      editor.view.dispatch(editor.state.tr.insertText('!'));
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const changed = onChange.mock.lastCall?.[0];
    expect(changed?.content[2]?.content?.[0]?.text).toBe('Third!');
    // Only "Third" was typed in; "Second ^dup" is ADR-0003's untouched block.
    expect(changed?.content[1]?.attrs?.['anchor'] ?? null).toBe('dup');
  });
});

describe('picking a block of another note that holds one id twice', () => {
  it('does not link the second block by the id that names the first', async () => {
    // Plans.md on disk: `Pack the tent ^dup\n\nBook the train ^dup\n`. Its outline
    // (`blockOutline`) offers both blocks as `dup`; `^dup` names the first.
    const entries: OutlineEntry[] = [
      { kind: 'block', text: 'Pack the tent', id: 'dup', type: 'paragraph', at: [0] },
      { kind: 'block', text: 'Book the train', id: 'dup', type: 'paragraph', at: [1] },
    ];
    const anchor = vi.fn<BlockPicking['anchor']>(async () => 'n3w1d2');
    const blocks: BlockPicking = {
      ...picking,
      choicesFor: async (target) =>
        target === 'Plans' ? { same: false, target, path: 'Plans.md' as VaultPath, entries } : null,
      anchor,
    };
    const { editor } = await renderEditor(doc({ type: 'paragraph' }), blocks);
    act(() => {
      editor.commands.focus('end');
      for (const char of '[[Plans#Book') {
        const { from, to } = editor.state.selection;
        editor.view.dispatch(editor.state.tr.insertText(char, from, to));
      }
    });
    await screen.findByRole('option', { name: /Book the train/ });
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event));
    });
    await waitFor(() => expect(JSON.stringify(editor.getJSON())).toContain('"target":"Plans"'));
    // `anchorBlock` gives the second block an id of its own; the picker never asks it.
    expect(JSON.stringify(editor.getJSON())).not.toContain('#^dup');
  });
});

describe('a keystroke in a note with many block ids', () => {
  it('walks the document a bounded number of times, not once per id', async () => {
    // Measured in jsdom: 2000 ids cost ~340 ms a keystroke, 800 ids ~55 ms,
    // against under 1 ms with none — `idsFollowTheirWords` walks the whole
    // document once for every id the document held before the change.
    const count = 300;
    const blocks = Array.from({ length: count }, (_, index) =>
      paragraph(`Block ${index}`, `id${index}`),
    );
    const { editor } = await renderEditor(doc(...blocks));
    type Walk = (callback: (...args: unknown[]) => unknown) => void;
    const proto = Object.getPrototypeOf(editor.state.doc) as { descendants: Walk };
    const original = proto.descendants;
    let visits = 0;
    const spy = vi.spyOn(proto, 'descendants').mockImplementation(function (
      this: unknown,
      callback,
    ) {
      original.call(this, (...args: unknown[]) => {
        visits += 1;
        return callback(...args);
      });
    });
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('x', 2));
    });
    spy.mockRestore();
    expect(editor.state.doc.firstChild?.textContent).toBe('Bxlock 0');
    // The document holds 2 × 300 nodes: a few whole walks are fine, 300 are not.
    expect(visits).toBeLessThan(20 * 2 * count);
  });
});

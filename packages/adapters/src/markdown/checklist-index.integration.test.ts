/**
 * P30-03 (integration): a note's checklist as the index is told it, read by
 * the real markdown reader — the boxes the editor draws, and the progress
 * through them — and the same again when the index is thrown away and
 * rebuilt from the files.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import {
  fakeIndexPort,
  fakeVaultFs,
  refreshIndex,
  type IndexedNote,
  type IndexPort,
} from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

const FILES: Record<string, string> = {
  'Plan the launch.md': [
    '---',
    'type: task',
    '---',
    '- [x] Book the hall',
    '- [ ] Order chairs',
    '  - [x] Count the guests',
    '> - [ ] Ring Mara Quill',
    '',
    '```',
    '- [x] Not a box: code',
    '```',
    '',
    '- [ ] Send the invitations',
    '',
  ].join('\n'),
  'Shopping.md': '- Bread\n- Milk\n',
};

const fs = fakeVaultFs({
  listNotes: async () =>
    Object.entries(FILES).map(([path, text]) => ({
      name: path,
      path: createVaultPath(path),
      modified: 1,
      size: text.length,
    })),
  readNotes: async (paths) =>
    paths.map((path) => {
      const text = FILES[path] ?? '';
      return { path, text, modified: 1, size: text.length };
    }),
});

/** An index that keeps what it is told, and forgets it all when cleared. */
function memoryIndex(): IndexPort & { readonly notes: Map<string, IndexedNote> } {
  const notes = new Map<string, IndexedNote>();
  return {
    ...fakeIndexPort({
      clear: async () => notes.clear(),
      manifest: async () =>
        [...notes.values()].map(({ path, modified, size, digest, type }) => ({
          path,
          modified,
          size,
          digest,
          type,
        })),
      put: async (put) => {
        for (const note of put) notes.set(note.path, note);
      },
    }),
    notes,
  };
}

const checklistOf = (index: ReturnType<typeof memoryIndex>, path: string) => {
  const note = index.notes.get(path);
  return { checks: note?.checks, progress: note?.progress };
};

describe('a checklist in the index', () => {
  it('is every box the editor draws, and the progress through them', async () => {
    const index = memoryIndex();
    await refreshIndex({ fs, index, markdown: remarkMarkdown });
    expect(checklistOf(index, 'Plan the launch.md')).toEqual({
      checks: [
        { done: true, text: 'Book the hall' },
        { done: false, text: 'Order chairs' },
        { done: true, text: 'Count the guests' },
        { done: false, text: 'Ring Mara Quill' },
        { done: false, text: 'Send the invitations' },
      ],
      progress: 40,
    });
    expect(checklistOf(index, 'Shopping.md')).toEqual({ checks: [], progress: null });
  });

  it('is the same after the index is thrown away and rebuilt', async () => {
    const index = memoryIndex();
    await refreshIndex({ fs, index, markdown: remarkMarkdown });
    const before = checklistOf(index, 'Plan the launch.md');
    await index.clear();
    expect(index.notes.size).toBe(0);
    await refreshIndex({ fs, index, markdown: remarkMarkdown });
    expect(checklistOf(index, 'Plan the launch.md')).toEqual(before);
  });
});

import { describe, expect, it } from 'vitest';
import { parseObjectType, type EditorDocument } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from './ports.ts';
import { readLinkPreview } from './read-link-preview.ts';

/** A body is read as one paragraph per line. */
const markdown: MarkdownPort = {
  ...fakeMarkdown(),
  parseBody: (body) => {
    const doc: EditorDocument = {
      type: 'doc',
      content: body
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
    };
    return { blocks: [], doc };
  },
};

const TASK = parseObjectType({ name: 'task', label: 'Task', properties: {} });
const file = (path: string, text: string) => ({ path, text, modified: 1, size: text.length });

describe('readLinkPreview', () => {
  it('reads a note’s title, its type and folder, and its first lines', async () => {
    const fs = fakeVaultFs({
      readNotes: async (paths) =>
        paths.map((path) =>
          file(path, '---\ntype: task\n---\nLeave .atlas/ out.\nEvery view.\nAnd more.\n'),
        ),
    });
    const preview = await readLinkPreview({
      fs,
      markdown,
      types: [TASK],
      path: 'Tasks/P16-04.md',
    });
    expect(preview).toEqual({
      title: 'P16-04',
      kicker: 'Task · Tasks',
      excerpt: 'Leave .atlas/ out.\nEvery view.\nAnd more.',
    });
  });

  it('names a note by its own title, and says nothing it does not know', async () => {
    const fs = fakeVaultFs({
      readNotes: async (paths) =>
        paths.map((path) => file(path, '---\ntitle: The plan\ntype: unknown\n---\n')),
    });
    const preview = await readLinkPreview({ fs, markdown, types: [TASK], path: 'plan.md' });
    expect(preview).toEqual({ title: 'The plan', kicker: null, excerpt: null });
  });

  it('is null for a note the host cannot read', async () => {
    const fs = fakeVaultFs({ readNotes: async () => [] });
    expect(await readLinkPreview({ fs, markdown, types: [], path: 'gone.md' })).toBeNull();
  });
});

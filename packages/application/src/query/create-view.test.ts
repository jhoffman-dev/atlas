import { describe, expect, it } from 'vitest';
import { parseObjectType, type VaultPath } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createView, ViewRefusedError, writeViewNote } from './create-view.ts';

const markdown = fakeMarkdown();

const TASK = parseObjectType({
  name: 'task',
  label: 'Task',
  properties: { status: { kind: 'select', options: ['backlog', 'done'] } },
});

function recordingFs() {
  const created: { path: VaultPath; contents: string }[] = [];
  const fs = fakeVaultFs({ createNote: async (args) => void created.push(args) });
  return { fs, created };
}

describe('createView', () => {
  it('writes the view note in .atlas/views and says where', async () => {
    const { fs, created } = recordingFs();
    const path = await createView({
      fs,
      markdown,
      takenPaths: [],
      types: [TASK],
      request: { name: 'Task board', type: 'task', layout: 'board' },
    });

    expect(path).toBe('.atlas/views/Task board.md');
    expect(created).toHaveLength(1);
    const contents = created[0]?.contents ?? '';
    expect(contents).toContain('atlas: view');
    expect(contents).toContain('layout: board');
    expect(contents).toContain('groupBy: status');
    expect(contents).toMatch(/\n# Task board\n$/);
  });

  it('refuses what the rules refuse, before writing anything', async () => {
    const { fs, created } = recordingFs();
    const attempt = createView({
      fs,
      markdown,
      takenPaths: ['.atlas/views/Board.md'],
      types: [TASK],
      request: { name: 'board', type: 'task', layout: 'table' },
    });
    await expect(attempt).rejects.toThrow(ViewRefusedError);
    await expect(attempt).rejects.toThrow('There is already a view called “board”.');
    expect(created).toEqual([]);
  });

  it('passes on the host refusing to write over a file', async () => {
    const fs = fakeVaultFs({
      createNote: async () => {
        throw new Error('a note with that name already exists');
      },
    });
    await expect(
      createView({
        fs,
        markdown,
        takenPaths: [],
        types: [TASK],
        request: { name: 'Mine', type: 'task', layout: 'table' },
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('writeViewNote', () => {
  it('writes worked-out frontmatter under a checked name', async () => {
    const { fs, created } = recordingFs();
    const path = await writeViewNote({
      fs,
      markdown,
      takenPaths: [],
      name: 'Counts',
      frontmatter: { atlas: 'view', layout: 'table', sql: 'SELECT 1' },
    });
    expect(path).toBe('.atlas/views/Counts.md');
    expect(created[0]?.contents).toContain('sql: SELECT 1');
  });

  it('refuses a name with a separator in it', async () => {
    const { fs, created } = recordingFs();
    await expect(
      writeViewNote({
        fs,
        markdown,
        takenPaths: [],
        name: '../escape',
        frontmatter: {},
      }),
    ).rejects.toThrow(/cannot hold/);
    expect(created).toEqual([]);
  });
});

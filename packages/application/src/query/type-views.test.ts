import { describe, expect, it } from 'vitest';
import {
  parseObjectType,
  savedViewSummary,
  splitFrontmatter,
  typeViews,
  type SavedViewSummary,
  type VaultPath,
} from '@atlas/domain';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { setNoteProperties } from './set-property.ts';
import { ViewRefusedError } from './create-view.ts';
import {
  addTypeView,
  duplicateTab,
  duplicateTypeView,
  materializeDefaultView,
  moveTypeView,
  renameTab,
  renameTypeView,
  type TypeViewPorts,
} from './type-views.ts';

const TASK = parseObjectType({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'done'] },
    due: { kind: 'date' },
  },
});
const NOTE = parseObjectType({ name: 'note', label: 'Note', properties: { topic: 'text' } });

/** Frontmatter kept as JSON, so nested settings — filters, columns — survive a round trip. */
function jsonFrontmatter(): MarkdownPort {
  const read = (frontmatter: string | null): Record<string, unknown> => {
    const inner = (frontmatter ?? '')
      .replace(/^---\n/, '')
      .replace(/---\n?$/, '')
      .trim();
    return inner === '' ? {} : (JSON.parse(inner) as Record<string, unknown>);
  };
  return {
    ...fakeMarkdown(),
    frontmatterProperties: read,
    updateFrontmatter: (frontmatter, changes) => {
      const merged: Record<string, unknown> = { ...read(frontmatter) };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined) delete merged[key];
        else merged[key] = value;
      }
      return `---\n${JSON.stringify(merged)}\n---\n`;
    },
  };
}

const viewNote = (frontmatter: Record<string, unknown>, body = '# View\n') =>
  `---\n${JSON.stringify(frontmatter)}\n---\n${body}`;

/** A vault of view notes, and the use-cases' ports over it, recording each property write. */
function vaultOf(files: Record<string, string> = {}) {
  const memory = memoryVault(files);
  const markdown = jsonFrontmatter();
  const fs = fakeVaultFs(memory.fs);
  const propertyWrites: { path: string; values: Readonly<Record<string, unknown>> }[] = [];
  const ports: TypeViewPorts = {
    fs,
    markdown,
    writeProperties: async ({ path, values }) => {
      propertyWrites.push({ path, values });
      await setNoteProperties({ fs, markdown, path, values });
    },
  };
  const frontmatterOf = (path: string) =>
    markdown.frontmatterProperties(splitFrontmatter(memory.files.get(path) ?? '').frontmatter);
  /** The views as the catalogue would read them from the files now. */
  const views = (): SavedViewSummary[] =>
    [...memory.files.keys()].flatMap((path) => {
      const summary = savedViewSummary(path as VaultPath, frontmatterOf(path));
      return summary === null ? [] : [summary];
    });
  const known = () => ({ views: views(), takenPaths: views().map((view) => view.path) });
  const tabs = (type = 'task') => typeViews(views(), type).map((view) => view.title);
  return { ...memory, ports, propertyWrites, frontmatterOf, views, known, tabs };
}

describe('materializeDefaultView', () => {
  it('writes the default table the type was showing: every column, by title, placed first', async () => {
    const vault = vaultOf();
    const written = await materializeDefaultView({
      ports: vault.ports,
      type: TASK,
      ...vault.known(),
    });

    expect(written.path).toBe('.atlas/views/Task table.md');
    expect(vault.frontmatterOf(written.path)).toMatchObject({
      atlas: 'view',
      type: 'task',
      layout: 'table',
      columns: ['status', 'due'],
      sorts: [{ key: 'title', direction: 'asc' }],
      order: 1,
    });
    expect(written.summary).toMatchObject({ type: 'task', order: 1, title: 'Task table' });
  });

  it('takes the name it is renamed to while it is written', async () => {
    const vault = vaultOf();
    const written = await materializeDefaultView({
      ports: vault.ports,
      type: TASK,
      name: 'Everything',
      ...vault.known(),
    });
    expect(written.path).toBe('.atlas/views/Everything.md');
  });

  it('is refused for a type that has views already, writing nothing', async () => {
    const vault = vaultOf({ '.atlas/views/Board.md': viewNote({ atlas: 'view', type: 'task' }) });
    await expect(
      materializeDefaultView({ ports: vault.ports, type: TASK, ...vault.known() }),
    ).rejects.toThrow('Task has views already.');
    expect([...vault.files.keys()]).toEqual(['.atlas/views/Board.md']);
  });
});

describe('addTypeView', () => {
  it('adds a named, placed view at the end, writing that one file alone', async () => {
    const vault = vaultOf({
      '.atlas/views/All.md': viewNote({ atlas: 'view', type: 'task', order: 1 }),
      '.atlas/views/Mine.md': viewNote({ atlas: 'view', type: 'task', order: 2 }),
    });
    const before = vault.files.get('.atlas/views/All.md');

    const path = await addTypeView({
      ports: vault.ports,
      type: TASK,
      layout: 'board',
      ...vault.known(),
    });

    expect(path).toBe('.atlas/views/Task board.md');
    expect(vault.frontmatterOf(path)).toMatchObject({
      layout: 'board',
      groupBy: 'status',
      order: 3,
    });
    expect(vault.tabs()).toEqual(['All', 'Mine', 'Task board']);
    expect(vault.propertyWrites).toEqual([]);
    expect(vault.files.get('.atlas/views/All.md')).toBe(before);
  });

  it('writes the default table first on a type that had none, so adding keeps it', async () => {
    const vault = vaultOf();
    await addTypeView({ ports: vault.ports, type: TASK, layout: 'calendar', ...vault.known() });

    expect(vault.tabs()).toEqual(['Task table', 'Task calendar']);
    expect(vault.frontmatterOf('.atlas/views/Task calendar.md')).toMatchObject({
      dateKey: 'due',
      order: 2,
    });
  });

  it('places unplaced siblings once, so the new tab lands last rather than by layout', async () => {
    const vault = vaultOf({
      '.atlas/views/Work.md': viewNote({ atlas: 'view', type: 'task', layout: 'table' }),
    });
    await addTypeView({ ports: vault.ports, type: TASK, layout: 'board', ...vault.known() });
    expect(vault.tabs()).toEqual(['Work', 'Task board']);
    expect(vault.propertyWrites).toEqual([{ path: '.atlas/views/Work.md', values: { order: 1 } }]);
  });

  it('numbers past a name that is taken, in any case', async () => {
    const vault = vaultOf({
      '.atlas/views/task BOARD.md': viewNote({
        atlas: 'view',
        type: 'task',
        layout: 'board',
        groupBy: 'status',
      }),
    });
    const path = await addTypeView({
      ports: vault.ports,
      type: TASK,
      layout: 'board',
      ...vault.known(),
    });
    expect(path).toBe('.atlas/views/Task board 2.md');
  });

  it('refuses a layout the type cannot draw, before writing anything', async () => {
    const vault = vaultOf();
    const attempt = addTypeView({
      ports: vault.ports,
      type: NOTE,
      layout: 'board',
      ...vault.known(),
    });
    await expect(attempt).rejects.toThrow(ViewRefusedError);
    await expect(attempt).rejects.toThrow(
      'A board needs a property to group by, and Note has none.',
    );
    expect(vault.files.size).toBe(0);
  });
});

describe('duplicateTypeView', () => {
  const settings = {
    atlas: 'view',
    type: 'task',
    layout: 'board',
    groupBy: 'status',
    filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
  };

  it('copies every setting right after its source, under its name and without its star', async () => {
    const vault = vaultOf({
      '.atlas/views/Board.md': viewNote({
        ...settings,
        title: 'Open work',
        favorite: true,
        order: 1,
      }),
      '.atlas/views/Table.md': viewNote({ atlas: 'view', type: 'task', order: 2 }),
    });
    const source = vault.views().find((view) => view.title === 'Open work')!;

    const path = await duplicateTypeView({ ports: vault.ports, source, ...vault.known() });

    expect(path).toBe('.atlas/views/Open work copy.md');
    const copied = vault.frontmatterOf(path);
    expect(copied).toMatchObject({ ...settings, order: 2 });
    expect(copied).not.toHaveProperty('title');
    expect(copied).not.toHaveProperty('favorite');
    expect(vault.tabs()).toEqual(['Open work', 'Open work copy', 'Table']);
  });

  it('is the source’s file, every byte of it but its title, star and place', async () => {
    const source = `---\n${JSON.stringify({ ...settings, order: 1 })}\n---\n# Board\n\nFor standup.\n`;
    const vault = vaultOf({ '.atlas/views/Board.md': source });
    const board = vault.views()[0]!;

    const path = await duplicateTypeView({ ports: vault.ports, source: board, ...vault.known() });

    expect(vault.files.get(path)).toBe(
      `---\n${JSON.stringify({ ...settings, order: 2 })}\n---\n# Board\n\nFor standup.\n`,
    );
  });

  it('keeps a title no file can hold as the copy’s, under a file name a disk holds', async () => {
    const vault = vaultOf({
      '.atlas/views/Board.md': viewNote({ ...settings, title: 'Q1/Q2', order: 1 }),
    });
    const board = vault.views()[0]!;

    const path = await duplicateTypeView({ ports: vault.ports, source: board, ...vault.known() });

    expect(path).toBe('.atlas/views/Q1-Q2 copy.md');
    expect(vault.tabs()).toEqual(['Q1/Q2', 'Q1/Q2 copy']);
  });

  it('passes on a source that cannot be read, writing nothing', async () => {
    const vault = vaultOf();
    const ghost = savedViewSummary('.atlas/views/Gone.md' as VaultPath, {
      atlas: 'view',
      type: 'task',
    })!;
    await expect(
      duplicateTypeView({
        ports: vault.ports,
        source: ghost,
        views: [ghost],
        takenPaths: [ghost.path],
      }),
    ).rejects.toThrow('no such file');
    expect(vault.files.size).toBe(0);
  });
});

describe('moveTypeView', () => {
  it('reorders the tabs, and the order is what the files say afterwards', async () => {
    const vault = vaultOf({
      '.atlas/views/A.md': viewNote({ atlas: 'view', type: 'task', order: 1 }),
      '.atlas/views/B.md': viewNote({ atlas: 'view', type: 'task', order: 2 }),
      '.atlas/views/C.md': viewNote({ atlas: 'view', type: 'task', order: 3 }),
    });
    await moveTypeView({
      ports: vault.ports,
      views: vault.views(),
      typeName: 'task',
      path: '.atlas/views/A.md',
      to: 2,
    });
    expect(vault.tabs()).toEqual(['B', 'C', 'A']);
    expect(vault.propertyWrites).toHaveLength(1);
  });

  it('keeps every other byte of a view it places', async () => {
    const vault = vaultOf({
      '.atlas/views/A.md': viewNote({ atlas: 'view', type: 'task' }, '# A\n\nNotes about A.\n'),
      '.atlas/views/B.md': viewNote({ atlas: 'view', type: 'task' }),
    });
    await moveTypeView({
      ports: vault.ports,
      views: vault.views(),
      typeName: 'task',
      path: '.atlas/views/B.md',
      to: 0,
    });
    expect(vault.files.get('.atlas/views/A.md')).toMatch(/\n# A\n\nNotes about A\.\n$/);
    expect(vault.tabs()).toEqual(['B', 'A']);
  });

  it('stops at the first write that fails rather than leaving the rest half-done', async () => {
    const attempted: string[] = [];
    const ports: TypeViewPorts = {
      fs: fakeVaultFs(),
      markdown: fakeMarkdown(),
      writeProperties: async ({ path }) => {
        attempted.push(path);
        throw new Error('the disk is full');
      },
    };
    const views = ['A', 'B'].map((name) =>
      savedViewSummary(`.atlas/views/${name}.md` as VaultPath, { atlas: 'view', type: 'task' })!,
    );
    await expect(
      moveTypeView({ ports, views, typeName: 'task', path: views[1]!.path, to: 0 }),
    ).rejects.toThrow('the disk is full');
    expect(attempted).toHaveLength(1);
  });
});

describe('renameTypeView', () => {
  it('writes the new name as the view’s title and leaves its file where it is', async () => {
    const vault = vaultOf({ '.atlas/views/Board.md': viewNote({ atlas: 'view', type: 'task' }) });
    await renameTypeView({
      ports: vault.ports,
      path: '.atlas/views/Board.md' as VaultPath,
      name: '  Sprint  ',
    });
    expect(vault.tabs()).toEqual(['Sprint']);
    expect([...vault.files.keys()]).toEqual(['.atlas/views/Board.md']);
  });

  it('refuses a blank name, writing nothing', async () => {
    const vault = vaultOf({ '.atlas/views/Board.md': viewNote({ atlas: 'view', type: 'task' }) });
    await expect(
      renameTypeView({ ports: vault.ports, path: '.atlas/views/Board.md' as VaultPath, name: ' ' }),
    ).rejects.toThrow('Name the view.');
    expect(vault.propertyWrites).toEqual([]);
  });
});

describe('the default table’s tab', () => {
  const unwritten = '.atlas/views/Task table.md' as VaultPath;

  it('is written under the name it is renamed to', async () => {
    const vault = vaultOf();
    const path = await renameTab({
      ports: vault.ports,
      type: TASK,
      path: unwritten,
      name: 'All work',
      ...vault.known(),
    });
    expect(path).toBe('.atlas/views/All work.md');
    expect(vault.tabs()).toEqual(['All work']);
  });

  it('keeps a name no file can have as typed, writing it under one a disk holds', async () => {
    const vault = vaultOf();
    const path = await renameTab({
      ports: vault.ports,
      type: TASK,
      path: unwritten,
      name: 'Q1/Q2',
      ...vault.known(),
    });
    expect(path).toBe('.atlas/views/Q1-Q2.md');
    expect(vault.frontmatterOf(path)).toMatchObject({ title: 'Q1/Q2' });
    expect(vault.tabs()).toEqual(['Q1/Q2']);
  });

  it('is called what it was renamed to even when that file is taken, as a written tab is', async () => {
    const vault = vaultOf({
      '.atlas/views/Board.md': viewNote({ atlas: 'view', type: 'note' }),
    });
    const path = await renameTab({
      ports: vault.ports,
      type: TASK,
      path: unwritten,
      name: 'Board',
      ...vault.known(),
    });
    expect(path).toBe('.atlas/views/Board 2.md');
    expect(vault.tabs()).toEqual(['Board']);
  });

  it('fits a name too long for a file into one, keeping the whole name as its title', async () => {
    const vault = vaultOf();
    const name = 'é'.repeat(300);
    const path = await renameTab({
      ports: vault.ports,
      type: TASK,
      path: unwritten,
      name,
      ...vault.known(),
    });
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    expect(new TextEncoder().encode(fileName).length).toBeLessThanOrEqual(255);
    expect(vault.tabs()).toEqual([name]);
  });

  it('refuses a blank name before writing it', async () => {
    const vault = vaultOf();
    await expect(
      renameTab({ ports: vault.ports, type: TASK, path: unwritten, name: '', ...vault.known() }),
    ).rejects.toThrow('Name the view.');
    expect(vault.files.size).toBe(0);
  });

  it('is written, then copied, when it is duplicated: two tabs afterwards', async () => {
    const vault = vaultOf();
    const path = await duplicateTab({
      ports: vault.ports,
      type: TASK,
      path: unwritten,
      ...vault.known(),
    });
    expect(path).toBe('.atlas/views/Task table copy.md');
    expect(vault.tabs()).toEqual(['Task table', 'Task table copy']);
  });

  it('renames and copies a written view as one, not as a default', async () => {
    const vault = vaultOf({
      '.atlas/views/Board.md': viewNote({ atlas: 'view', type: 'task', order: 1 }),
    });
    const board = '.atlas/views/Board.md' as VaultPath;
    expect(
      await renameTab({
        ports: vault.ports,
        type: TASK,
        path: board,
        name: 'Sprint',
        ...vault.known(),
      }),
    ).toBe(board);
    expect(
      await duplicateTab({ ports: vault.ports, type: TASK, path: board, ...vault.known() }),
    ).toBe('.atlas/views/Sprint copy.md');
    expect(vault.tabs()).toEqual(['Sprint', 'Sprint copy']);
  });
});

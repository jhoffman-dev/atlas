/**
 * Tags as the app reads and changes them: counted from the index, listed by
 * the notes using them, and renamed across the vault — through the file for a
 * note no pane holds, with a pane's unsaved typing written first for one that
 * does, and each note that cannot be rewritten reported.
 */
import { describe, expect, it, vi } from 'vitest';
import { TAG_PAGE_SIZE, type VaultPath } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { tagIndexQuery } from '../testing/tag-index.ts';
import { loadTagCounts, loadTagCountsWhere, loadTaggedNotes } from './load-tags.ts';
import { renameTag, renameTagInNote, TagRenameError, tagRenamePlan } from './rename-tag.ts';

const markdown = fakeMarkdown();

function vault(files: Record<string, string>, { failOn = '' } = {}) {
  const disk = new Map(Object.entries(files));
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.map((path) => ({ path, text: disk.get(path) ?? '', modified: 1, size: 1 })),
    readTextFile: async (path) => ({ text: disk.get(path) ?? '', modified: 1 }),
    writeTextFile: vi.fn(async ({ path, contents }: { path: string; contents: string }) => {
      if (path === failOn) throw new Error('the note changed on disk');
      disk.set(path, contents);
      return 2;
    }),
  });
  return { fs, disk, index: fakeIndexPort({ query: tagIndexQuery({ files, markdown }) }) };
}

const FILES = {
  'a.md': 'An #idea, and #Idea again, and #ideas.\n',
  'b.md': '---\ntags: idea, other\n---\nBody with #idea/sub.\n',
  'c.md': 'Nothing but `#idea` in code.\n',
  'd.md': 'Only #thought here.\n',
};

const closed = () => ({
  state: () => 'closed' as const,
  flush: vi.fn(async () => {}),
  reload: vi.fn(),
});

describe('loadTagCounts', () => {
  it('counts every use of every tag, shown as first written', async () => {
    const { index } = vault(FILES);
    expect(await loadTagCounts({ index })).toEqual([
      { key: 'idea', name: 'idea', count: 3 },
      { key: 'idea/sub', name: 'idea/sub', count: 1 },
      { key: 'ideas', name: 'ideas', count: 1 },
      { key: 'other', name: 'other', count: 1 },
      { key: 'thought', name: 'thought', count: 1 },
    ]);
  });

  it('reads page after page until one comes back short', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        columns: ['key', 'name', 'count'],
        rows: Array.from({ length: TAG_PAGE_SIZE }, (_, at) => [`t${at}`, `t${at}`, 1]),
        truncated: false,
      })
      .mockResolvedValueOnce({ columns: ['key', 'name', 'count'], rows: [], truncated: false });
    const counts = await loadTagCounts({ index: fakeIndexPort({ query }) });
    expect(counts).toHaveLength(TAG_PAGE_SIZE);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('loadTagCountsWhere', () => {
  it('counts only the uses in the notes it is asked about, shown as the first of those spells it', async () => {
    const { index } = vault({
      '.atlas/templates/A.md': '#IDEA #plan\n',
      'b.md': '#Idea #idea/sub\n',
      'c.md': '#idea\n',
    });
    const counts = await loadTagCountsWhere({ index, includes: (path) => !path.startsWith('.') });
    expect(counts).toEqual([
      { key: 'idea', name: 'Idea', count: 2 },
      { key: 'idea/sub', name: 'idea/sub', count: 1 },
    ]);
  });
});

describe('loadTaggedNotes', () => {
  it('lists the notes using a tag or one nested under it, but not one sharing its letters', async () => {
    const { index } = vault(FILES);
    expect(await loadTaggedNotes({ index, key: 'idea' })).toEqual([
      { path: 'a.md', title: 'a', count: 2 },
      { path: 'b.md', title: 'b', count: 2 },
    ]);
  });
});

describe('renameTagInNote', () => {
  it('renames in the tags property and the body, leaving the rest', () => {
    expect(
      renameTagInNote({
        text: '---\ntags: idea, other\n---\nBody #idea and #ideas.\n',
        markdown,
        rename: { from: 'idea', to: 'thought' },
      }),
    ).toEqual({
      text: '---\ntags: thought, other\n---\nBody #thought and #ideas.\n',
      count: 2,
      problem: null,
    });
  });

  it('hands back the text untouched when the tag is not in it', () => {
    const text = '---\ntitle: x\n---\nnone';
    expect(renameTagInNote({ text, markdown, rename: { from: 'idea', to: 'y' } })).toEqual({
      text,
      count: 0,
      problem: null,
    });
  });
});

describe('tagRenamePlan', () => {
  it('counts the uses a rename would change, by note, reading each file', async () => {
    const { fs, index } = vault(FILES);
    const plan = await tagRenamePlan({
      index,
      fs,
      markdown,
      rename: { from: 'idea', to: 'concept' },
    });
    expect(plan.notes).toEqual([
      { path: 'a.md', title: 'a', count: 2 },
      { path: 'b.md', title: 'b', count: 2 },
    ]);
    expect(plan.total).toBe(4);
    expect(plan.mergesInto).toBeNull();
  });

  it('reaches archived notes, and merges into a tag only they use (A20-05)', async () => {
    const { fs, index } = vault({ ...FILES, 'Archive/Old.md': 'Kept #idea and #concept.\n' });
    const plan = await tagRenamePlan({
      index,
      fs,
      markdown,
      rename: { from: 'idea', to: 'concept' },
    });
    expect(plan.notes.map((note) => note.path)).toContain('Archive/Old.md');
    expect(plan.mergesInto).toBe('concept');
  });

  it('leaves archived notes out of the counts and the notes listed (A20-05)', async () => {
    const { index } = vault({ 'Live.md': '#idea\n', 'Archive/Old.md': '#idea #old\n' });
    expect((await loadTagCounts({ index })).map((tag) => [tag.key, tag.count])).toEqual([
      ['idea', 1],
    ]);
    expect((await loadTaggedNotes({ index, key: 'idea' })).map((note) => note.path)).toEqual([
      'Live.md',
    ]);
  });

  it('names the tag it would merge into when the new name is in use', async () => {
    const { fs, index } = vault(FILES);
    const plan = await tagRenamePlan({
      index,
      fs,
      markdown,
      rename: { from: 'idea', to: 'Thought' },
    });
    expect(plan.mergesInto).toBe('thought');
  });

  it('is not a merge when only the case changes', async () => {
    const { fs, index } = vault(FILES);
    const plan = await tagRenamePlan({ index, fs, markdown, rename: { from: 'idea', to: 'Idea' } });
    expect(plan.mergesInto).toBeNull();
    // `#Idea` in a.md is already written so: only the other three change.
    expect(plan.total).toBe(3);
  });

  it('names a tag in use only as the parent of others as the one it would merge into', async () => {
    // `#Beta` has no use of its own, but renaming `#beta` back would carry `#Beta/y` with it.
    const { fs, index } = vault({ 'a.md': 'Uses #alpha.\n', 'b.md': 'Uses #Beta/y.\n' });
    const plan = await tagRenamePlan({
      index,
      fs,
      markdown,
      rename: { from: 'alpha', to: 'beta' },
    });
    expect(plan.mergesInto).toBe('Beta');
  });

  it('is no merge into a parent only the renamed tag itself makes', async () => {
    const { fs, index } = vault({ 'a.md': 'Uses #a/b.\n' });
    const plan = await tagRenamePlan({ index, fs, markdown, rename: { from: 'a/b', to: 'a' } });
    expect(plan.mergesInto).toBeNull();
  });

  it('names the notes the new name could not be read back in, and leaves them out', async () => {
    const { fs, index } = vault({ 'a.md': 'Uses #idea_ here.\n', 'b.md': 'Uses #idea.\n' });
    const plan = await tagRenamePlan({
      index,
      fs,
      markdown,
      rename: { from: 'idea', to: 'my tag' },
    });
    expect(plan.notes).toEqual([{ path: 'b.md', title: 'b', count: 1 }]);
    expect(plan.refused).toEqual([{ path: 'a.md', reason: expect.stringMatching(/#my tag#/) }]);
  });

  it('refuses a name a tag cannot have', async () => {
    const { fs, index } = vault(FILES);
    await expect(
      tagRenamePlan({ index, fs, markdown, rename: { from: 'idea', to: '42' } }),
    ).rejects.toBeInstanceOf(TagRenameError);
  });
});

describe('renameTag', () => {
  const plan = async (files: Record<string, string>, failOn = '') => {
    const found = vault(files, { failOn });
    return {
      ...found,
      plan: await tagRenamePlan({
        ...found,
        markdown,
        rename: { from: 'idea', to: 'concept' },
      }),
    };
  };

  it('rewrites every note the plan found, byte for byte apart from the tags', async () => {
    const { fs, disk, plan: found } = await plan(FILES);
    const report = await renameTag({ fs, markdown, openNotes: closed(), plan: found });
    expect(report).toEqual({ updated: ['a.md', 'b.md'], failed: [] });
    expect(disk.get('a.md')).toBe('An #concept, and #concept again, and #ideas.\n');
    expect(disk.get('b.md')).toBe('---\ntags: concept, other\n---\nBody with #concept/sub.\n');
    expect(disk.get('c.md')).toBe(FILES['c.md']);
  });

  it('writes each note against the version it read', async () => {
    const { fs, plan: found } = await plan(FILES);
    await renameTag({ fs, markdown, openNotes: closed(), plan: found });
    expect(fs.writeTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.md', expectedModified: 1 }),
    );
  });

  it('writes a pane’s unsaved typing first, and reloads a pane holding the note', async () => {
    const { fs, plan: found } = await plan(FILES);
    let dirty = true;
    const openNotes = {
      state: (path: VaultPath) => (path === 'a.md' ? (dirty ? 'dirty' : 'clean') : 'closed'),
      flush: vi.fn(async () => {
        dirty = false;
      }),
      reload: vi.fn(),
    } as const;
    const report = await renameTag({ fs, markdown, openNotes, plan: found });
    expect(openNotes.flush).toHaveBeenCalledWith(['a.md']);
    expect(openNotes.reload).toHaveBeenCalledWith('a.md');
    expect(report.updated).toContain('a.md');
  });

  it('leaves a note still being typed in, and says so', async () => {
    const { fs, disk, plan: found } = await plan(FILES);
    const openNotes = {
      state: (path: VaultPath) => (path === 'a.md' ? ('dirty' as const) : ('closed' as const)),
      flush: vi.fn(async () => {}),
      reload: vi.fn(),
    };
    const report = await renameTag({ fs, markdown, openNotes, plan: found });
    expect(report.failed).toEqual([{ path: 'a.md', reason: 'The note has unsaved changes.' }]);
    expect(disk.get('a.md')).toBe(FILES['a.md']);
    expect(report.updated).toEqual(['b.md']);
  });

  it('carries on past a note that cannot be written', async () => {
    const { fs, plan: found } = await plan(FILES, 'a.md');
    const report = await renameTag({ fs, markdown, openNotes: closed(), plan: found });
    expect(report.failed).toEqual([{ path: 'a.md', reason: 'the note changed on disk' }]);
    expect(report.updated).toEqual(['b.md']);
  });

  it('leaves a note the new name could no longer be read back in since the plan, and says why', async () => {
    const found = vault({ 'a.md': 'Uses #idea.\n' });
    const planned = await tagRenamePlan({
      ...found,
      markdown,
      rename: { from: 'idea', to: 'my tag' },
    });
    found.disk.set('a.md', 'Uses #idea#x.\n');
    const report = await renameTag({ fs: found.fs, markdown, openNotes: closed(), plan: planned });
    expect(report.failed).toEqual([{ path: 'a.md', reason: expect.stringMatching(/#my tag#/) }]);
    expect(found.disk.get('a.md')).toBe('Uses #idea#x.\n');
  });

  it('skips a note whose tag has gone since the plan was made', async () => {
    const { fs, disk, plan: found } = await plan(FILES);
    disk.set('a.md', 'no tags now\n');
    const report = await renameTag({ fs, markdown, openNotes: closed(), plan: found });
    expect(report.updated).toEqual(['b.md']);
    expect(disk.get('a.md')).toBe('no tags now\n');
  });
});

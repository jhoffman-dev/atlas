// @vitest-environment jsdom
/**
 * The Archive as the app drives it, over a vault in memory and the real
 * markdown adapter — so the stamps are written, and taken off, by the same
 * YAML code that writes every other property, and the bytes are checked.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  createVaultPath,
  parentVaultPath,
  vaultPathName,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs, type ArchivePorts, type IndexPort } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useArchive, type ArchiveOptions } from './use-archive.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

function vault(notes: Record<string, string>) {
  const files = new Map(Object.entries(notes));
  const dirs = new Set<string>(
    [...files.keys()].flatMap((at) => {
      const parent = parentVaultPath(path(at));
      return parent === '' ? [] : [parent];
    }),
  );
  const entry = (at: string, kind: VaultEntry['kind']) =>
    ({ kind, name: vaultPathName(path(at)), path: path(at) }) as VaultEntry;
  const fs = fakeVaultFs({
    listDirectory: async (parent) => [
      ...[...dirs]
        .filter((at) => parentVaultPath(path(at)) === parent)
        .map((at) => entry(at, 'directory')),
      ...[...files.keys()]
        .filter((at) => parentVaultPath(path(at)) === parent)
        .map((at) => entry(at, 'file')),
    ],
    createFolder: async ({ path: at }) => void dirs.add(at),
    moveEntry: async (move) => {
      const text = files.get(move.from);
      if (text === undefined) throw new Error('no such entry');
      files.delete(move.from);
      files.set(move.to, text);
    },
    readTextFile: async (at) => ({ text: files.get(at) ?? '', modified: 1 }),
    readNotes: async (paths) =>
      paths.flatMap((at) => {
        const text = files.get(at);
        return text === undefined ? [] : [{ path: at, text, modified: 1, size: text.length }];
      }),
    writeTextFile: async ({ path: at, contents }) => {
      files.set(at, contents);
      return 2;
    },
  });
  return { fs, files };
}

function setUp(notes: Record<string, string>, overrides: Partial<ArchiveOptions> = {}) {
  const disk = vault(notes);
  const query = vi.fn<IndexPort['query']>(async () => ({
    columns: ['path', 'title', 'archived', 'archivedFrom'],
    rows: [['Archive/Old.md', 'Old', '2026-09-01', 'Old.md']],
    truncated: false,
  }));
  const ports: ArchivePorts = {
    fs: disk.fs,
    index: fakeIndexPort({ query }),
    markdown: remarkMarkdown,
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  const options: ArchiveOptions = {
    ports,
    clock: { today: () => '2026-09-27' },
    notePaths: Object.keys(notes).map(path),
    indexKey: '1',
    open: false,
    onSettled: vi.fn(),
    offerLinks: vi.fn(async () => {}),
    ...overrides,
  };
  const hook = renderHook((props: ArchiveOptions) => useArchive(props), { initialProps: options });
  return { ...disk, hook, options, query };
}

describe('useArchive', () => {
  it('archives a note with the real frontmatter writer, and unarchives it to exactly its bytes', async () => {
    const original = '---\nstatus: done # finished\ntags: [a, b]\n---\n\n# Plan\n\nBody.\n';
    const { files, hook, options } = setUp({ 'Projects/Plan.md': original });

    act(() => {
      void hook.result.current.commands.archive([path('Projects/Plan.md')]);
    });
    await waitFor(() => expect(hook.result.current.commands.busy).toBe(false));
    expect(files.get('Archive/Projects/Plan.md')).toBe(
      '---\nstatus: done # finished\ntags: [a, b]\narchived: 2026-09-27\narchivedFrom: Projects/Plan.md\n---\n\n# Plan\n\nBody.\n',
    );
    expect(hook.result.current.notice).toBeNull();
    expect(options.onSettled).toHaveBeenCalled();

    hook.rerender({ ...options, notePaths: [path('Archive/Projects/Plan.md')] });
    act(() => {
      void hook.result.current.commands.unarchive([path('Archive/Projects/Plan.md')]);
    });
    await waitFor(() => expect(files.has('Projects/Plan.md')).toBe(true));
    expect(files.get('Projects/Plan.md')).toBe(original);
  });

  it('takes the frontmatter it added off a note that had none', async () => {
    const original = '# Loose note\n\nNo frontmatter here.\n';
    const { files, hook, options } = setUp({ 'Loose.md': original });

    act(() => {
      void hook.result.current.commands.archive([path('Loose.md')]);
    });
    await waitFor(() => expect(files.has('Archive/Loose.md')).toBe(true));
    await waitFor(() => expect(hook.result.current.commands.busy).toBe(false));
    hook.rerender({ ...options, notePaths: [path('Archive/Loose.md')] });
    act(() => {
      void hook.result.current.commands.unarchive([path('Archive/Loose.md')]);
    });
    await waitFor(() => expect(files.get('Loose.md')).toBe(original));
  });

  it('offers a single note’s links as a move does, and leaves a batch’s to the batch', async () => {
    const { files, hook, options } = setUp({ 'a.md': '', 'b.md': '', 'c.md': '' });

    act(() => {
      void hook.result.current.commands.archive([path('a.md')]);
    });
    await waitFor(() => expect(options.offerLinks).toHaveBeenCalledTimes(1));
    expect(options.offerLinks).toHaveBeenCalledWith(
      { path: 'a.md', kind: 'file' },
      expect.objectContaining({ move: { from: 'a.md', to: 'Archive/a.md' } }),
      options.notePaths,
    );

    act(() => {
      void hook.result.current.commands.archive([path('b.md'), path('c.md')]);
    });
    await waitFor(() => expect(files.has('Archive/c.md')).toBe(true));
    await waitFor(() => expect(hook.result.current.commands.busy).toBe(false));
    expect(options.offerLinks).toHaveBeenCalledTimes(1);
  });

  it('says what could not be archived, and only that', async () => {
    const { hook } = setUp({ 'a.md': '' });
    act(() => {
      void hook.result.current.commands.archive([path('a.md'), path('Gone.md')]);
    });
    await waitFor(() => expect(hook.result.current.notice).toBe('Gone: no such entry'));
  });

  it('reads the Archive only while its page is open, and again as the search changes', async () => {
    const { hook, options, query } = setUp({});
    expect(hook.result.current.page.contents).toBeNull();
    expect(query).not.toHaveBeenCalled();

    hook.rerender({ ...options, open: true });
    await waitFor(() => expect(hook.result.current.page.contents?.notes).toHaveLength(1));
    expect(hook.result.current.page.contents?.notes[0]).toMatchObject({
      title: 'Old',
      from: 'Old.md',
      archivedOn: '2026-09-01',
    });

    act(() => hook.result.current.page.setSearch('old'));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls[1]?.[1]).toContain('*[oO][lL][dD]*');
  });

  // A23: the palette and a page's menu call `archive` without looking at `busy`,
  // so a second press while the first batch is under way must not start another.
  it('keeps the Archive’s rows that could not go back chosen, and lets go of the rest (A20-05)', async () => {
    const { files, hook } = setUp({ 'Archive/a.md': '---\narchivedFrom: a.md\n---\n', 'b.md': '' });
    act(() => {
      hook.result.current.page.choosing.selection.onToggle('Archive/a.md');
      hook.result.current.page.choosing.selection.onToggle('b.md');
    });
    act(() => hook.result.current.page.unarchive([path('Archive/a.md'), path('b.md')]));
    expect(hook.result.current.page.choosing.chosen).toHaveLength(2);
    await waitFor(() => expect(files.has('a.md')).toBe(true));
    await waitFor(() => expect(hook.result.current.page.choosing.chosen).toEqual(['b.md']));
  });

  it('A23: does not start a second batch while one is under way', async () => {
    const { hook, files, fs } = setUp({ 'a.md': '' });
    const moves = vi.spyOn(fs, 'moveEntry');
    act(() => {
      hook.result.current.commands.archive([path('a.md')]);
      hook.result.current.commands.archive([path('a.md')]);
    });
    await waitFor(() => expect(files.has('Archive/a.md')).toBe(true));
    await waitFor(() => expect(hook.result.current.commands.busy).toBe(false));
    expect(moves).toHaveBeenCalledTimes(1);
  });
});

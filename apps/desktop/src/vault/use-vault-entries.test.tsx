// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { VaultPath } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs, type VaultFsPort } from '@atlas/application';
import { useVaultEntries, type VaultEntryPorts } from './use-vault-entries.ts';

const NOTE = 'Notes/Plan.md' as VaultPath;

function ports(
  reload: () => Promise<void>,
  fs: VaultFsPort = fakeVaultFs({ moveEntry: async () => {} }),
): VaultEntryPorts {
  return {
    fs,
    index: fakeIndexPort(),
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: vi.fn(),
      abandon: () => {},
      reload: vi.fn(),
    },
    tree: { reload, expandDirectory: vi.fn(), forgetDirectory: vi.fn(), isExpanded: () => false },
    closeNotes: vi.fn(),
    refresh: vi.fn(),
    createNoteIn: async () => {},
    overlay: { show: vi.fn(), hide: vi.fn() },
  };
}

describe('useVaultEntries', () => {
  it('says so when the tree cannot be re-read after a rename', async () => {
    const reload = vi.fn(() => Promise.reject(new Error('the folder could not be read')));
    const { result } = renderHook(() => useVaultEntries(ports(reload), [NOTE]));
    act(() => result.current.rename({ kind: 'file', path: NOTE }, 'Roadmap'));
    await waitFor(() => expect(result.current.notice).toBe('the folder could not be read'));
    expect(reload).toHaveBeenCalled();
  });

  it('offers to update the links a rename left behind, and updates them when asked', async () => {
    const disk = new Map([
      ['Notes/Plan.md', '# Plan\n'],
      ['a.md', 'See [[Plan]] and [[Plan|the plan]].\n'],
      ['b.md', 'Also [[Plan]].\n'],
    ]);
    const fs = fakeVaultFs({
      moveEntry: async ({ from, to }) => {
        disk.set(to, disk.get(from) ?? '');
        disk.delete(from);
      },
      readNotes: async (paths) =>
        paths.map((path) => ({ path, text: disk.get(path) ?? '', modified: 1, size: 1 })),
      readTextFile: async (path) => ({ text: disk.get(path) ?? '', modified: 1 }),
      writeTextFile: async ({ path, contents }) => {
        disk.set(path, contents);
        return 2;
      },
    });
    const notes = ['Notes/Plan.md', 'a.md', 'b.md'] as VaultPath[];
    const { result } = renderHook(() =>
      useVaultEntries(
        ports(async () => {}, fs),
        notes,
      ),
    );

    act(() => result.current.rename({ kind: 'file', path: NOTE }, 'Roadmap'));
    await waitFor(() => expect(result.current.links).not.toBeNull());
    expect(result.current.links?.text).toBe('3 links in 2 notes still point at “Plan”.');
    expect(result.current.links?.action).toBe('Update 3 links');
    // Nothing is rewritten until the person says so.
    expect(disk.get('a.md')).toBe('See [[Plan]] and [[Plan|the plan]].\n');

    act(() => result.current.links?.update());
    await waitFor(() => expect(result.current.links).toBeNull());
    expect(disk.get('a.md')).toBe('See [[Roadmap]] and [[Roadmap|the plan]].\n');
    expect(disk.get('b.md')).toBe('Also [[Roadmap]].\n');
  });

  it('leaves the links as they are when the offer is dismissed', async () => {
    const disk = new Map([['a.md', '[[Plan]]']]);
    const fs = fakeVaultFs({
      readNotes: async (paths) =>
        paths.map((path) => ({ path, text: disk.get(path) ?? '', modified: 1, size: 1 })),
      writeTextFile: vi.fn(async () => 2),
    });
    const notes = ['Notes/Plan.md', 'a.md'] as VaultPath[];
    const { result } = renderHook(() =>
      useVaultEntries(
        ports(async () => {}, fs),
        notes,
      ),
    );
    act(() => result.current.rename({ kind: 'file', path: NOTE }, 'Roadmap'));
    await waitFor(() => expect(result.current.links?.action).toBe('Update 1 link'));
    act(() => result.current.links?.dismiss());
    expect(result.current.links).toBeNull();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
  });
});

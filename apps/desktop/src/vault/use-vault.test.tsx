// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import type { VaultEntry, VaultPath } from '@atlas/domain';
import type {
  VaultFsPort,
  VaultLocation,
  VaultLocationStore,
  VaultPickerPort,
} from '@atlas/application';
import { useVault, type VaultPorts } from './use-vault.ts';

const A: VaultLocation = { absolutePath: '/Users/j/A', name: 'A' };
const B: VaultLocation = { absolutePath: '/Users/j/B', name: 'B' };

const fs: VaultFsPort = {
  listDirectory: async () => [] as VaultEntry[],
  listNotes: async () => [],
  readNotes: async () => [],
  readBinaryFile: async () => new ArrayBuffer(0),
  createFolder: async () => {},
  trashEntry: async () => {},
  writeBinaryFile: async () => 0,
  moveEntry: async () => {},
  createNote: async () => 0,
  readTextFile: async () => ({ text: '', modified: 1 }),
  writeTextFile: async () => 2,
};

/** A store the way the workspace's is: moved by `onSwitched`, read through `useSyncExternalStore`. */
function externalVault() {
  let vault: string | null = null;
  const listeners = new Set<() => void>();
  return {
    set(next: string) {
      vault = next;
      for (const listener of listeners) listener();
    },
    use: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => vault,
      ),
  };
}

/** The ports as the app hands them over; the host's fs here never binds a vault. */
const portsWith = (overrides: Partial<VaultPorts>): VaultPorts => ({
  fs: fs as unknown as VaultPorts['fs'],
  watch: { start: async () => {}, onChange: async () => () => {} },
  picker: { pickDirectory: async () => B },
  store: { read: async () => A, write: async () => {} },
  ...overrides,
});

describe('useVault, switching vaults (R14-01)', () => {
  it('moves the location and what changes hands with it in one commit, never a render apart', async () => {
    const remembered: VaultLocationStore = { read: async () => A, write: async () => {} };
    const picker: VaultPickerPort = { pickDirectory: async () => B };
    const store = externalVault();
    const seen: [string | null, string | null][] = [];
    const { result } = renderHook(() => {
      const view = useVault(portsWith({ picker, store: remembered }), {
        onSwitched: (next) => store.set(next.absolutePath),
      });
      seen.push([view.location?.absolutePath ?? null, store.use()]);
      return view;
    });
    await act(async () => {});
    expect(result.current.location).toEqual(A);
    await act(async () => result.current.chooseVault());
    expect(result.current.location).toEqual(B);
    // Every render agreed with itself: the store's vault is the location's.
    expect(seen.filter(([location, vault]) => location !== vault)).toEqual([]);
    expect(
      seen.some(([location, vault]) => location === B.absolutePath && vault === B.absolutePath),
    ).toBe(true);
  });

  it('says which vault its note list is for, and nothing while the next one is on its way', async () => {
    let listed: VaultPath[] = [];
    const listing: VaultFsPort = {
      ...fs,
      listNotes: async () => listed.map((path) => ({ name: path, path, modified: 1, size: 1 })),
    };
    const remembered: VaultLocationStore = { read: async () => A, write: async () => {} };
    const picker: VaultPickerPort = { pickDirectory: async () => B };
    const { result } = renderHook(() =>
      useVault(
        portsWith({ fs: listing as unknown as VaultPorts['fs'], picker, store: remembered }),
      ),
    );
    await act(async () => {});
    expect(result.current.notesListedFor).toBe(A.absolutePath);
    listed = ['b.md' as VaultPath];
    await act(async () => result.current.chooseVault());
    expect(result.current.notesListedFor).toBe(B.absolutePath);
    expect(result.current.notePaths).toEqual(['b.md']);
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createNoteChanges, type VaultRead } from '@atlas/application';
import { createIndexStatusStore } from '../index/index-status-store.ts';
import type { ReadInvalidator } from './read-invalidator.ts';
import { useVaultReads } from './use-vault-reads.ts';

function recordingReads() {
  const invalidated: [string, VaultRead[]][] = [];
  const forgot: string[] = [];
  const moved: string[] = [];
  const reads: ReadInvalidator = {
    invalidate: (vault, which) => invalidated.push([vault, [...which]]),
    invalidateWithIndex: vi.fn(),
    indexMoved: (vault) => moved.push(vault),
    waitingFor: () => new Set(),
    forget: (vault) => forgot.push(vault),
  };
  return { reads, invalidated, forgot, moved };
}

describe('the window’s reads, kept to the vault open', () => {
  it('reads the types again for a type definition a sync found changed', () => {
    const { reads, invalidated } = recordingReads();
    const changes = createNoteChanges({ onError: (cause) => expect.fail(String(cause)) });
    renderHook(() =>
      useVaultReads({ reads, changes, index: createIndexStatusStore(), vaultKey: '/one' }),
    );

    changes.publish({
      vault: '/one',
      changes: [{ kind: 'changed', path: '.atlas/types/book.md', type: null, digest: 'd' }],
    });
    changes.publish({
      vault: '/one',
      changes: [{ kind: 'changed', path: 'a.md', type: null, digest: 'd' }],
    });

    expect(invalidated).toEqual([
      ['/one', ['types', 'sidebar-atlas', 'quick-counts']],
      ['/one', []],
    ]);
  });

  it('drops the vault left behind on a switch, and not the one open when drawn again', () => {
    const { reads, forgot } = recordingReads();
    const changes = createNoteChanges({ onError: () => {} });
    const index = createIndexStatusStore();
    const hook = renderHook((props) => useVaultReads({ reads, changes, index, ...props }), {
      initialProps: { vaultKey: '/one' as string | null },
    });

    hook.rerender({ vaultKey: '/one' });
    expect(forgot).toEqual([]);
    hook.rerender({ vaultKey: '/two' });
    hook.rerender({ vaultKey: null });
    expect(forgot).toEqual(['/one', '/two']);
  });

  it('tells the reads the index has news when its revision moves or it settles, and not while it builds', () => {
    const { reads, moved } = recordingReads();
    const changes = createNoteChanges({ onError: () => {} });
    const index = createIndexStatusStore();
    renderHook(() => useVaultReads({ reads, changes, index, vaultKey: '/one' }));

    act(() => index.setState({ vault: '/one', phase: 'building' }));
    expect(moved).toEqual([]);
    act(() => index.setState({ phase: 'ready', revision: 1 }));
    act(() => index.setState({ notes: 4 }));
    act(() => index.setState({ revision: 2 }));
    act(() => index.setState({ phase: 'failed', revision: 3, message: 'locked' }));

    expect(moved).toEqual(['/one', '/one', '/one']);
  });
});

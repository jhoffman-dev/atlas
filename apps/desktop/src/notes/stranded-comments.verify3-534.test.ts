// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createVaultPath, STRANDED_EDIT_LIFETIME_MS, type StrandedComments } from '@dfai/domain';
import { useStrandedComments, type StrandedCommentStore } from './stranded-comments.ts';

const NOTE = createVaultPath('Library/The Last Lamp.md');
const VAULT = '/Users/someone/Vault';
const NOW = 1_700_000_000_000;
const REFUSED = 'The comment changed in the note meanwhile, so it was not written over.';
const TYPED = { id: 'k3x9q2', comment: 'Typed, then ⌘W.', base: 'Lit by Mara.' };

/** A store that outlives the hooks over it: a fresh hook on it is DFAI started again. */
function memoryStore({ refuseWrites = false } = {}) {
  const entries = new Map<string, StrandedComments>();
  const store: StrandedCommentStore = {
    read: () => [...entries.values()],
    put: ({ edit }) => {
      if (refuseWrites) return false;
      entries.set(edit.path, edit);
      return true;
    },
    remove: ({ path }) => void entries.delete(path),
  };
  return { store, entries };
}

const run = (store: StrandedCommentStore, now = NOW) =>
  renderHook(() => useStrandedComments({ store, vaultKey: VAULT, now: () => now }));

const keepTyped = (hook: ReturnType<typeof run>) =>
  act(() =>
    hook.result.current.keep({ vault: VAULT, path: NOTE, comments: [TYPED], reason: REFUSED }),
  );

/*
 * Verification pass 3 on f4c54b6b (#534). Comments kept with a clock that ran
 * ahead are redated to "now" when read, as kept typing is — but only in
 * memory: kept typing stores the redated entry (stranded-edits.ts, "Stored
 * redated, or the next start would find it in the future again"); kept
 * comments do not, so every start finds them in the future and they never
 * reach their month.
 */
describe('comments kept with a clock that ran ahead', () => {
  it('let go a month after DFAI first started with them', () => {
    const { store, entries } = memoryStore();
    keepTyped(run(store, NOW + 365 * 24 * 60 * 60 * 1000));
    run(store, NOW).unmount();
    const later = run(store, NOW + STRANDED_EDIT_LIFETIME_MS + 1);
    expect(later.result.current.offered(NOTE)).toEqual([]);
    expect(entries.size).toBe(0);
  });
});

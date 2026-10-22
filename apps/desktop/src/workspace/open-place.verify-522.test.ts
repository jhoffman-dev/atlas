// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createVaultPath, type VaultPath } from '@dfai/domain';
import { createRevealStore } from '../panes/reveals.ts';
import { closePeek, createOverlayStore, openPeek, peekNow } from '../overlay-store.ts';
import { clickLink, openNote, type LinkPlaces } from './open-place.ts';
import {
  closePane,
  createWorkspaceStore,
  loadVault,
  splitPane,
  workspaceNow,
} from './workspace-store.ts';

/*
 * Verification (#506, PR #522 after 54f53fc3): a `[[…pdf]]` link opens
 * once the vault has been walked, which on a large vault is a quarter of a
 * second or more. Whether the late answer is still wanted is judged by the
 * pane's number and the peek's note — neither of which says which vault,
 * which pane, or which peek the click was made in.
 */

const PLAN = createVaultPath('Plan.md');
const ELSEWHERE = createVaultPath('Elsewhere.md');
const PDF = createVaultPath('Library/the-lantern-keepers.pdf');

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function wiring() {
  const walk = deferred<VaultPath | null>();
  const places: LinkPlaces = {
    blockOpening: async ({ note, blockId }) => ({ kind: 'note', note, blockId }),
    linkedPdf: () => walk.promise,
  };
  const store = createWorkspaceStore({ remembered: { read: () => null, write: () => {} } });
  loadVault(store, '/vaults/first');
  openNote(store, PLAN);
  return {
    walk,
    linking: {
      store,
      reveals: createRevealStore(),
      overlays: createOverlayStore(),
      notePaths: [PLAN, ELSEWHERE],
      onProblem: vi.fn(),
      places,
    },
  };
}

const everyPlace = (w: ReturnType<typeof wiring>) =>
  workspaceNow(w.linking.store).panes.flatMap((pane) =>
    pane.tabs.map((tab) => tab.history.current),
  );

const flush = () => new Promise((done) => setTimeout(done, 0));

describe('a [[…pdf]] link still being looked up when the vault is switched', () => {
  it('a ⌘-click does not open the first vault’s PDF path in the second vault', async () => {
    const w = wiring();
    clickLink(w.linking, {
      pane: 0,
      target: 'the-lantern-keepers.pdf',
      how: 'new-tab',
      inPeek: false,
    });
    loadVault(w.linking.store, '/vaults/second');
    openNote(w.linking.store, PLAN);
    w.walk.resolve(PDF);
    await flush();
    expect(everyPlace(w)).not.toContainEqual({ kind: 'document', path: PDF });
  });

  it('a plain click does not open it either, though the second vault shows a note of the same path', async () => {
    const w = wiring();
    clickLink(w.linking, {
      pane: 0,
      target: 'the-lantern-keepers.pdf',
      how: 'here',
      inPeek: false,
    });
    loadVault(w.linking.store, '/vaults/second');
    openNote(w.linking.store, PLAN);
    w.walk.resolve(PDF);
    await flush();
    expect(everyPlace(w)).not.toContainEqual({ kind: 'document', path: PDF });
  });
});

describe('a ⌘-click on [[…pdf]] in the right-hand pane, when the left-hand one is closed', () => {
  it('still opens its tab: the pane it was made in is still there, only renumbered', async () => {
    const w = wiring();
    splitPane(w.linking.store, 0);
    openNote(w.linking.store, ELSEWHERE);
    clickLink(w.linking, {
      pane: 1,
      target: 'the-lantern-keepers.pdf',
      how: 'new-tab',
      inPeek: false,
    });
    closePane(w.linking.store, 0);
    w.walk.resolve(PDF);
    await flush();
    expect(everyPlace(w)).toContainEqual({ kind: 'document', path: PDF });
  });
});

describe('a [[…pdf]] link clicked in the peek, the peek closed and opened again on the same note', () => {
  it('does not close the new peek nor replace the pane', async () => {
    const w = wiring();
    openPeek(w.linking.overlays, { path: ELSEWHERE, from: null });
    clickLink(w.linking, { pane: 0, target: 'the-lantern-keepers.pdf', how: 'here', inPeek: true });
    closePeek(w.linking.overlays);
    openPeek(w.linking.overlays, { path: ELSEWHERE, from: null });
    w.walk.resolve(PDF);
    await flush();
    expect(everyPlace(w)).toEqual([{ kind: 'note', path: PLAN }]);
    expect(peekNow(w.linking.overlays)?.path).toBe(ELSEWHERE);
  });
});

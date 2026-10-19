import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { createRevealStore } from '../panes/reveals.ts';
import { followLink, openNote } from './open-place.ts';
import { createWorkspaceStore, loadVault, splitPane, workspaceNow } from './workspace-store.ts';

const PLAN = createVaultPath('Plan.md');
const OTHER = createVaultPath('Other.md');

function following() {
  const store = createWorkspaceStore({ remembered: { read: () => null, write: () => {} } });
  loadVault(store, '/v');
  const onProblem = vi.fn();
  const reveals = createRevealStore();
  return { store, reveals, notePaths: [PLAN, OTHER], onProblem };
}

const placesOf = (store: ReturnType<typeof following>['store'], pane = 0) =>
  workspaceNow(store).panes[pane]?.tabs.map((tab) => tab.history.current) ?? [];

describe('openNote', () => {
  it('opens here unless the click asked for a new tab or a split', () => {
    const { store } = following();
    openNote(store, PLAN);
    openNote(store, OTHER, 'new-tab');
    expect(placesOf(store)).toEqual([
      { kind: 'note', path: PLAN },
      { kind: 'note', path: OTHER },
    ]);
    openNote(store, PLAN, 'split');
    expect(workspaceNow(store).panes).toHaveLength(2);
  });
});

describe('followLink', () => {
  it('opens the note in the pane the link was clicked in, and scrolls to its heading', () => {
    const wiring = following();
    openNote(wiring.store, PLAN);
    splitPane(wiring.store);

    followLink(wiring, { pane: 0, target: 'Other', heading: '#Goals' });

    expect(placesOf(wiring.store, 0)).toEqual([{ kind: 'note', path: OTHER }]);
    expect(placesOf(wiring.store, 1)).toEqual([{ kind: 'note', path: PLAN }]);
    expect(workspaceNow(wiring.store).focused).toBe(0);
    const tab = workspaceNow(wiring.store).panes[0]?.active ?? '';
    expect(wiring.reveals.getState().byTab.get(tab)).toMatchObject({
      path: OTHER,
      reveal: { fragment: { kind: 'heading', heading: 'Goals' } },
    });
    expect(wiring.onProblem).toHaveBeenCalledWith(null);
  });

  it('takes a link naming no note as a place in the note it is in', () => {
    const wiring = following();
    openNote(wiring.store, PLAN);
    followLink(wiring, { pane: 0, target: '', heading: '#^abc123' });
    expect(placesOf(wiring.store)).toEqual([{ kind: 'note', path: PLAN }]);
    expect(wiring.reveals.getState().byTab.get('t1')?.reveal.fragment).toEqual({
      kind: 'block',
      id: 'abc123',
    });
  });

  it('opens the link in a new tab beside the clicked tab on ⌘-click, and beside on ⌘⇧-click', () => {
    const wiring = following();
    openNote(wiring.store, PLAN);
    splitPane(wiring.store);
    followLink(wiring, { pane: 0, target: 'Other', heading: '#Goals', how: 'new-tab' });
    expect(placesOf(wiring.store, 0)).toEqual([
      { kind: 'note', path: PLAN },
      { kind: 'note', path: OTHER },
    ]);
    expect(placesOf(wiring.store, 1)).toEqual([{ kind: 'note', path: PLAN }]);
    expect(workspaceNow(wiring.store).focused).toBe(0);
    const tab = workspaceNow(wiring.store).panes[0]?.active ?? '';
    expect(wiring.reveals.getState().byTab.get(tab)?.path).toBe(OTHER);

    const split = following();
    openNote(split.store, PLAN);
    followLink(split, { pane: 0, target: 'Other', how: 'split' });
    expect(placesOf(split.store, 1)).toEqual([{ kind: 'note', path: OTHER }]);
    expect(placesOf(split.store, 0)).toEqual([{ kind: 'note', path: PLAN }]);
  });

  it('reports a link that leads nowhere and opens nothing', () => {
    const wiring = following();
    openNote(wiring.store, PLAN);
    followLink(wiring, { pane: 0, target: 'Missing' });
    expect(wiring.onProblem).toHaveBeenCalledWith('No note called "Missing"');
    expect(placesOf(wiring.store)).toEqual([{ kind: 'note', path: PLAN }]);
    expect(wiring.reveals.getState().byTab.size).toBe(0);
  });
});

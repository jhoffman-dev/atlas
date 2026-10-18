import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { HISTORY_LIMIT, NO_HISTORY, type NavigationPlace } from './navigation-history.ts';
import { MAX_PANES } from './pane-layout.ts';
import {
  activateNth,
  activePlace,
  activateTab,
  activeTabOf,
  CLOSED_LIMIT,
  closePaneInWorkspace,
  closeTab,
  EMPTY_WORKSPACE,
  focusPaneInWorkspace,
  followMoveInWorkspace,
  forgetNotesInWorkspace,
  goBackInTab,
  goForwardInTab,
  isWorkspaceSplit,
  moveTabToPane,
  newTab,
  nextTab,
  openInActiveTab,
  openInActiveTabOf,
  openInNewTab,
  openInSplit,
  pinTab,
  previousTab,
  reopenClosedTab,
  reorderTab,
  splitWithTab,
  tabPlace,
  unpinTab,
  type Workspace,
} from './workspace.ts';

const note = (name: string): NavigationPlace => ({
  kind: 'note',
  path: createVaultPath(`${name}.md`),
});
const acme = note('Acme');
const beta = note('Beta');
const gamma = note('Gamma');
const today: NavigationPlace = { kind: 'today' };

/** The ids of a pane's tabs, left to right. */
const idsOf = (ws: Workspace, pane = 0) => (ws.panes[pane]?.tabs ?? []).map((tab) => tab.id);
/** The place each tab of a pane shows, left to right. */
const placesOf = (ws: Workspace, pane = 0) =>
  (ws.panes[pane]?.tabs ?? []).map((tab) => tabPlace(tab));
const activeIdOf = (ws: Workspace, pane = ws.focused) => ws.panes[pane]?.active;

/** Acme, Beta and Gamma as three tabs of one pane, Gamma active. */
function threeTabs(): Workspace {
  return openInNewTab(openInNewTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta), gamma);
}

describe('the empty workspace', () => {
  it('is one pane holding one empty tab, which is where the first open lands', () => {
    expect(EMPTY_WORKSPACE.panes).toHaveLength(1);
    expect(idsOf(EMPTY_WORKSPACE)).toEqual(['t1']);
    expect(activeIdOf(EMPTY_WORKSPACE)).toBe('t1');
    expect(activePlace(EMPTY_WORKSPACE)).toBeNull();
    expect(EMPTY_WORKSPACE.closed).toEqual([]);
  });
});

describe('opening', () => {
  it('shows the tab already on the place instead of opening it again (a plain click)', () => {
    const ws = activateTab(threeTabs(), { pane: 0, id: 't3' });
    const next = openInActiveTab(ws, acme);
    expect(activeIdOf(next)).toBe('t1');
    expect(placesOf(next)).toEqual([acme, beta, gamma]);
    expect(activeTabOf(next).history.back).toEqual([]);
  });

  it('stays on the active tab when it already shows the place, over another copy', () => {
    const ws = openInNewTab(openInActiveTab(EMPTY_WORKSPACE, acme), acme);
    expect(openInActiveTab(ws, acme)).toBe(ws);
  });

  it('looks for the place in the focused pane only', () => {
    const split = splitWithTab(openInActiveTab(EMPTY_WORKSPACE, acme));
    const ws = openInActiveTab(openInActiveTab(split, beta), acme);
    expect(ws.focused).toBe(1);
    expect(placesOf(ws, 1)).toEqual([acme]);
    expect(activeTabOf(ws).history.back).toEqual([acme, beta]);
  });

  it('opens in the focused pane’s active tab, as a step in that tab’s history', () => {
    const ws = openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta);
    expect(placesOf(ws)).toEqual([beta]);
    expect(activeTabOf(ws).history.back).toEqual([acme]);
  });

  it('opens in a named pane’s active tab and makes that pane the focused one', () => {
    const split = splitWithTab(openInActiveTab(EMPTY_WORKSPACE, acme));
    const ws = openInActiveTabOf(focusPaneInWorkspace(split, 0), { pane: 1, place: beta });
    expect(ws.focused).toBe(1);
    expect(placesOf(ws, 1)).toEqual([beta]);
    expect(placesOf(ws, 0)).toEqual([acme]);
  });

  it('refuses a pane that is not there rather than opening in another', () => {
    const ws = openInActiveTab(EMPTY_WORKSPACE, acme);
    expect(openInActiveTabOf(ws, { pane: 1, place: beta })).toBe(ws);
    expect(openInActiveTabOf(ws, { pane: -1, place: beta })).toBe(ws);
    expect(openInActiveTabOf(ws, { pane: 0.5, place: beta })).toBe(ws);
  });

  it('opens a new tab right after the active one and activates it (⌘-click)', () => {
    const first = activateTab(threeTabs(), { pane: 0, id: 't1' });
    const next = openInNewTab(first, today);
    expect(placesOf(next)).toEqual([acme, today, beta, gamma]);
    expect(activeIdOf(next)).toBe('t4');
    expect(activeTabOf(next).history).toEqual({ back: [], current: today, forward: [] });
  });

  it('mints every id from nextId, so two tabs never share one', () => {
    const ws = threeTabs();
    expect(idsOf(ws)).toEqual(['t1', 't2', 't3']);
    expect(ws.nextId).toBe(4);
  });

  it('adds an empty tab at the end of the focused pane and activates it (+)', () => {
    const ws = newTab(activateTab(threeTabs(), { pane: 0, id: 't1' }));
    expect(idsOf(ws)).toEqual(['t1', 't2', 't3', 't4']);
    expect(activeIdOf(ws)).toBe('t4');
    expect(activePlace(ws)).toBeNull();
  });

  it('allows the same place in two tabs', () => {
    const ws = openInNewTab(openInActiveTab(EMPTY_WORKSPACE, acme), acme);
    expect(placesOf(ws)).toEqual([acme, acme]);
  });
});

describe('closing', () => {
  it('closes a tab and activates its right neighbour', () => {
    const ws = closeTab(activateTab(threeTabs(), { pane: 0, id: 't2' }), { pane: 0, id: 't2' });
    expect(idsOf(ws)).toEqual(['t1', 't3']);
    expect(activeIdOf(ws)).toBe('t3');
  });

  it('activates the left neighbour when the closed tab was the last', () => {
    const ws = closeTab(threeTabs(), { pane: 0, id: 't3' });
    expect(idsOf(ws)).toEqual(['t1', 't2']);
    expect(activeIdOf(ws)).toBe('t2');
  });

  it('leaves the active tab alone when another one closes', () => {
    const ws = closeTab(threeTabs(), { pane: 0, id: 't1' });
    expect(idsOf(ws)).toEqual(['t2', 't3']);
    expect(activeIdOf(ws)).toBe('t3');
  });

  it('closes a split pane with its last tab, and the focus goes to the pane left', () => {
    const split = splitWithTab(threeTabs());
    const ws = closeTab(split, { pane: 1, id: 't4' });
    expect(ws.panes).toHaveLength(1);
    expect(ws.focused).toBe(0);
    expect(idsOf(ws)).toEqual(['t1', 't2', 't3']);
  });

  it('leaves one fresh empty tab when the only pane’s last tab closes', () => {
    const ws = closeTab(openInActiveTab(EMPTY_WORKSPACE, acme), { pane: 0, id: 't1' });
    expect(ws.panes).toHaveLength(1);
    expect(idsOf(ws)).toEqual(['t2']);
    expect(activePlace(ws)).toBeNull();
    expect(activeTabOf(ws).history).toEqual(NO_HISTORY);
  });

  it('refuses a tab or a pane that is not there', () => {
    const ws = threeTabs();
    expect(closeTab(ws, { pane: 0, id: 't9' })).toBe(ws);
    expect(closeTab(ws, { pane: 1, id: 't1' })).toBe(ws);
  });

  it('keeps the closed tab, newest first, so ⌘⇧T can bring it back with its history', () => {
    const first = closeTab(threeTabs(), { pane: 0, id: 't1' });
    const ws = closeTab(first, { pane: 0, id: 't2' });
    expect(ws.closed.map((tab) => tab.id)).toEqual(['t2', 't1']);
    expect(tabPlace(ws.closed[1]!)).toEqual(acme);
  });

  it(`remembers at most ${CLOSED_LIMIT} closed tabs, forgetting the oldest`, () => {
    let ws = EMPTY_WORKSPACE;
    for (let n = 0; n < CLOSED_LIMIT + 3; n += 1) ws = openInNewTab(ws, note(`N${n}`));
    for (let n = 0; n < CLOSED_LIMIT + 3; n += 1) {
      const id = ws.panes[0]!.tabs[1]!.id;
      ws = closeTab(ws, { pane: 0, id });
    }
    expect(ws.closed).toHaveLength(CLOSED_LIMIT);
    expect(tabPlace(ws.closed[0]!)).toEqual(note(`N${CLOSED_LIMIT + 2}`));
    expect(ws.closed.some((tab) => tabPlace(tab)?.kind === 'note' && tab.id === 't2')).toBe(false);
  });

  it('reopens the most recently closed tab beside the active one, with its history, and activates it', () => {
    const before = openInActiveTab(threeTabs(), today);
    const closed = closeTab(before, { pane: 0, id: 't3' });
    const ws = reopenClosedTab(activateTab(closed, { pane: 0, id: 't1' }));
    expect(idsOf(ws)).toEqual(['t1', 't3', 't2']);
    expect(activeIdOf(ws)).toBe('t3');
    expect(activeTabOf(ws).history.back).toEqual([gamma]);
    expect(activePlace(ws)).toEqual(today);
    expect(ws.closed).toEqual([]);
  });

  it('replaces a lone blank tab with the reopened one, rather than keeping both', () => {
    const closed = closeTab(openInActiveTab(EMPTY_WORKSPACE, acme), { pane: 0, id: 't1' });
    expect(activePlace(closed)).toBeNull();
    const ws = reopenClosedTab(closed);
    expect(idsOf(ws)).toEqual(['t1']);
    expect(activePlace(ws)).toEqual(acme);
  });

  it('keeps a blank tab that is not alone, and one that holds a history', () => {
    const closed = closeTab(threeTabs(), { pane: 0, id: 't3' });
    expect(idsOf(reopenClosedTab(newTab(closed)))).toEqual(['t1', 't2', 't4', 't3']);
    const emptied = forgetNotesInWorkspace(
      closeTab(openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta), {
        pane: 0,
        id: 't1',
      }),
      () => true,
    );
    const back = openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta);
    const lone = { ...goBackInTab(back), closed: emptied.closed };
    expect(idsOf(reopenClosedTab({ ...lone, closed: closed.closed }))).toEqual(['t1', 't3']);
  });

  it('reopens nothing when nothing was closed', () => {
    const ws = threeTabs();
    expect(reopenClosedTab(ws)).toBe(ws);
  });
});

describe('switching', () => {
  it('activates a tab, and the pane it is in takes the focus', () => {
    const split = splitWithTab(threeTabs());
    const ws = activateTab(split, { pane: 0, id: 't1' });
    expect(ws.focused).toBe(0);
    expect(activeIdOf(ws, 0)).toBe('t1');
  });

  it('refuses a tab that is not in the pane', () => {
    const ws = threeTabs();
    expect(activateTab(ws, { pane: 0, id: 't9' })).toBe(ws);
  });

  it('steps to the next tab and wraps round (⌃Tab)', () => {
    const ws = nextTab(threeTabs());
    expect(activeIdOf(ws)).toBe('t1');
    expect(activeIdOf(nextTab(ws))).toBe('t2');
  });

  it('steps to the previous tab and wraps round (⌃⇧Tab)', () => {
    const ws = previousTab(activateTab(threeTabs(), { pane: 0, id: 't1' }));
    expect(activeIdOf(ws)).toBe('t3');
    expect(activeIdOf(previousTab(ws))).toBe('t2');
  });

  it('activates the nth tab, and the ninth is the last (⌘1–9)', () => {
    const ws = threeTabs();
    expect(activeIdOf(activateNth(ws, 1))).toBe('t1');
    expect(activeIdOf(activateNth(ws, 2))).toBe('t2');
    expect(activeIdOf(activateNth(ws, 9))).toBe('t3');
  });

  it('does nothing for a number past the tabs, or outside 1–9', () => {
    const ws = activateTab(threeTabs(), { pane: 0, id: 't1' });
    expect(activateNth(ws, 4)).toBe(ws);
    expect(activateNth(ws, 0)).toBe(ws);
    expect(activateNth(ws, 10)).toBe(ws);
  });

  it('is the same workspace when the tab is already active', () => {
    const ws = threeTabs();
    expect(activateTab(ws, { pane: 0, id: 't3' })).toBe(ws);
  });
});

describe('ordering', () => {
  it('moves a tab to another place in its pane', () => {
    const ws = reorderTab(threeTabs(), { pane: 0, id: 't1', to: 2 });
    expect(idsOf(ws)).toEqual(['t2', 't3', 't1']);
  });

  it('clamps a place past the ends', () => {
    expect(idsOf(reorderTab(threeTabs(), { pane: 0, id: 't3', to: -4 }))).toEqual([
      't3',
      't1',
      't2',
    ]);
    expect(idsOf(reorderTab(threeTabs(), { pane: 0, id: 't1', to: 9 }))).toEqual([
      't2',
      't3',
      't1',
    ]);
  });

  it('refuses a tab that is not in the pane, or a place that is not a whole number', () => {
    const ws = threeTabs();
    expect(reorderTab(ws, { pane: 0, id: 't9', to: 0 })).toBe(ws);
    expect(reorderTab(ws, { pane: 0, id: 't1', to: 1.5 })).toBe(ws);
    const split = splitWithTab(ws);
    expect(moveTabToPane(split, { id: 't1', from: 0, to: 1, at: 0.5 })).toBe(split);
  });

  it('moves a tab into the other pane, where it is active and focused', () => {
    const split = splitWithTab(threeTabs());
    const ws = moveTabToPane(focusPaneInWorkspace(split, 0), { id: 't1', from: 0, to: 1, at: 0 });
    expect(idsOf(ws, 0)).toEqual(['t2', 't3']);
    expect(idsOf(ws, 1)).toEqual(['t1', 't4']);
    expect(ws.focused).toBe(1);
    expect(activeIdOf(ws, 1)).toBe('t1');
  });

  it('activates a neighbour in the pane a moved active tab leaves', () => {
    const split = splitWithTab(threeTabs());
    const ws = moveTabToPane(split, { id: 't3', from: 0, to: 1, at: 1 });
    expect(activeIdOf(ws, 0)).toBe('t2');
    expect(idsOf(ws, 1)).toEqual(['t4', 't3']);
  });

  it('collapses the split when the last tab leaves a pane', () => {
    const split = splitWithTab(threeTabs());
    const ws = moveTabToPane(split, { id: 't4', from: 1, to: 0, at: 0 });
    expect(ws.panes).toHaveLength(1);
    expect(idsOf(ws, 0)).toEqual(['t4', 't1', 't2', 't3']);
    expect(ws.focused).toBe(0);
    expect(activeIdOf(ws, 0)).toBe('t4');
  });

  it('collapses the split when the last tab leaves the first pane, keeping the focus on the tab', () => {
    const split = splitWithTab(openInActiveTab(EMPTY_WORKSPACE, acme));
    const ws = moveTabToPane(split, { id: 't1', from: 0, to: 1, at: 1 });
    expect(ws.panes).toHaveLength(1);
    expect(idsOf(ws, 0)).toEqual(['t2', 't1']);
    expect(ws.focused).toBe(0);
    expect(activeIdOf(ws)).toBe('t1');
  });

  it('is a reorder when the tab moves within its own pane', () => {
    const ws = moveTabToPane(threeTabs(), { id: 't1', from: 0, to: 0, at: 2 });
    expect(idsOf(ws)).toEqual(['t2', 't3', 't1']);
  });

  it('refuses a move from or to a pane that is not there', () => {
    const ws = threeTabs();
    expect(moveTabToPane(ws, { id: 't1', from: 0, to: 1, at: 0 })).toBe(ws);
    expect(moveTabToPane(ws, { id: 't1', from: 2, to: 0, at: 0 })).toBe(ws);
    expect(moveTabToPane(ws, { id: 't9', from: 0, to: 0, at: 0 })).toBe(ws);
  });
});

describe('panes', () => {
  it('splits with a copy of the active tab, under a new id, and focuses the new pane', () => {
    const ws = splitWithTab(openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta));
    expect(ws.panes).toHaveLength(2);
    expect(ws.focused).toBe(1);
    expect(idsOf(ws, 1)).toEqual(['t2']);
    expect(activeTabOf(ws).history).toEqual({ back: [acme], current: beta, forward: [] });
    expect(isWorkspaceSplit(ws)).toBe(true);
  });

  it(`never has more than ${MAX_PANES} panes: a further split is a no-op`, () => {
    const split = splitWithTab(threeTabs());
    expect(splitWithTab(split)).toBe(split);
  });

  it('opens in a split: a new pane when there is room, the other pane when there is not', () => {
    const ws = openInSplit(openInActiveTab(EMPTY_WORKSPACE, acme), beta);
    expect(placesOf(ws, 0)).toEqual([acme]);
    expect(placesOf(ws, 1)).toEqual([beta]);
    expect(ws.focused).toBe(1);

    const again = openInSplit(focusPaneInWorkspace(ws, 0), gamma);
    expect(again.panes).toHaveLength(2);
    expect(placesOf(again, 1)).toEqual([gamma]);
    expect(again.focused).toBe(1);
  });

  it('closes a pane with every tab in it, and the other pane is left as it was', () => {
    const split = splitWithTab(threeTabs());
    const ws = closePaneInWorkspace(split, 0);
    expect(ws.panes).toHaveLength(1);
    expect(idsOf(ws, 0)).toEqual(['t4']);
    expect(ws.focused).toBe(0);
  });

  it('keeps a closed pane’s tabs for ⌘⇧T, the shown one first, pinned ones not at all', () => {
    const split = pinTab(splitWithTab(activateTab(threeTabs(), { pane: 0, id: 't2' })), {
      pane: 0,
      id: 't1',
    });
    const ws = closePaneInWorkspace(split, 0);
    expect(ws.closed.map((tab) => tab.id)).toEqual(['t2', 't3']);
    expect(idsOf(reopenClosedTab(ws), 0)).toEqual(['t4', 't2']);
  });

  it(`keeps at most ${CLOSED_LIMIT} tabs after a pane closes: the shown one, then the pane's order`, () => {
    let ws = splitWithTab(EMPTY_WORKSPACE);
    for (let n = 0; n < CLOSED_LIMIT + 2; n += 1) ws = openInNewTab(ws, note(`N${n}`));
    const kept = closePaneInWorkspace(ws, 1).closed.map((tab) => tabPlace(tab));
    expect(kept).toHaveLength(CLOSED_LIMIT);
    expect(kept[0]).toEqual(note(`N${CLOSED_LIMIT + 1}`));
    expect(kept.slice(1)).toEqual([
      null,
      ...Array.from({ length: CLOSED_LIMIT - 2 }, (_, n) => note(`N${n}`)),
    ]);
  });

  it('keeps the focus on the same pane when a pane before it closes', () => {
    const split = splitWithTab(threeTabs());
    const ws = closePaneInWorkspace(split, 0);
    expect(activeIdOf(ws)).toBe('t4');
  });

  it('does not close the only pane, nor one that is not there', () => {
    const ws = threeTabs();
    expect(closePaneInWorkspace(ws, 0)).toBe(ws);
    expect(closePaneInWorkspace(splitWithTab(ws), 2)).toEqual(splitWithTab(ws));
  });

  it('focuses a pane, and only a pane that exists', () => {
    const split = splitWithTab(threeTabs());
    expect(focusPaneInWorkspace(split, 0).focused).toBe(0);
    expect(focusPaneInWorkspace(split, 1)).toBe(split);
    expect(focusPaneInWorkspace(split, 2)).toBe(split);
  });
});

describe('history', () => {
  it('goes back and forward in the focused pane’s active tab only', () => {
    const left = openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta);
    const split = openInActiveTab(splitWithTab(left), gamma);
    const back = goBackInTab(split);
    expect(activePlace(back)).toEqual(beta);
    expect(placesOf(back, 0)).toEqual([beta]);
    expect(activePlace(goForwardInTab(back))).toEqual(gamma);
  });

  it('is the same workspace when there is nowhere to go', () => {
    const ws = openInActiveTab(EMPTY_WORKSPACE, acme);
    expect(goBackInTab(ws)).toBe(ws);
    expect(goForwardInTab(ws)).toBe(ws);
  });

  it(`keeps each tab's history at ${HISTORY_LIMIT} places`, () => {
    let ws = EMPTY_WORKSPACE;
    for (let n = 0; n < HISTORY_LIMIT + 5; n += 1) ws = openInActiveTab(ws, note(`N${n}`));
    expect(activeTabOf(ws).history.back).toHaveLength(HISTORY_LIMIT);
  });
});

describe('after outside changes', () => {
  it('follows a moved note in every tab, in both panes and in the closed stack', () => {
    const one = openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta);
    const split = openInNewTab(splitWithTab(one), acme);
    const ws = closeTab(split, { pane: 1, id: 't3' });
    const moved = followMoveInWorkspace(ws, {
      from: createVaultPath('Acme.md'),
      to: createVaultPath('Done/Acme.md'),
    });
    expect(tabPlace(moved.closed[0]!)).toEqual(note('Done/Acme'));
    expect(activeTabOf(moved).history.back).toEqual([note('Done/Acme')]);
    expect(moved.panes[0]!.tabs[0]!.history.back).toEqual([note('Done/Acme')]);
  });

  it('is the same workspace when no tab is on the moved note', () => {
    const ws = closeTab(threeTabs(), { pane: 0, id: 't1' });
    const moved = followMoveInWorkspace(ws, {
      from: createVaultPath('Elsewhere.md'),
      to: createVaultPath('Moved.md'),
    });
    expect(moved).toBe(ws);
  });

  it('leaves a tab the delete did not empty, even an empty one', () => {
    const ws = newTab(openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta));
    const after = forgetNotesInWorkspace(ws, (path) => path === 'Acme.md');
    expect(idsOf(after)).toEqual(['t1', 't2']);
    const two = openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta);
    const split = newTab(splitWithTab(two));
    const left = closeTab(split, { pane: 1, id: 't2' });
    const stillSplit = forgetNotesInWorkspace(left, (path) => path === 'Beta.md');
    expect(stillSplit.panes).toHaveLength(2);
    expect(activeTabOf(stillSplit).history).toEqual(NO_HISTORY);
  });

  it('empties a tab on a deleted note, keeping Back so the tab can leave', () => {
    const ws = openInActiveTab(openInActiveTab(EMPTY_WORKSPACE, acme), beta);
    const after = forgetNotesInWorkspace(ws, (path) => path === 'Beta.md');
    expect(activePlace(after)).toBeNull();
    expect(activeTabOf(after).history.back).toEqual([acme]);
    expect(idsOf(after)).toEqual(['t1']);
  });

  it('closes a tab left with nothing at all, without putting it among the closed', () => {
    const ws = threeTabs();
    const after = forgetNotesInWorkspace(ws, (path) => path === 'Beta.md');
    expect(idsOf(after)).toEqual(['t1', 't3']);
    expect(after.closed).toEqual([]);
  });

  it('closes a split pane whose only tab was on a deleted note', () => {
    const split = openInNewTab(splitWithTab(openInActiveTab(EMPTY_WORKSPACE, acme)), beta);
    const ws = closeTab(split, { pane: 1, id: 't2' });
    const after = forgetNotesInWorkspace(ws, (path) => path === 'Beta.md');
    expect(after.panes).toHaveLength(1);
    expect(placesOf(after, 0)).toEqual([acme]);
  });

  it('leaves one empty tab when every tab of the only pane is gone', () => {
    const ws = openInNewTab(openInActiveTab(EMPTY_WORKSPACE, acme), acme);
    const after = forgetNotesInWorkspace(ws, () => true);
    expect(after.panes).toHaveLength(1);
    expect(after.panes[0]!.tabs).toHaveLength(1);
    expect(activePlace(after)).toBeNull();
  });

  it('forgets deleted notes among the closed tabs too, dropping ones left with nothing', () => {
    const ws = closeTab(threeTabs(), { pane: 0, id: 't1' });
    const after = forgetNotesInWorkspace(ws, (path) => path === 'Acme.md');
    expect(after.closed).toEqual([]);
  });

  it('is the same workspace when nothing it holds is gone', () => {
    const ws = threeTabs();
    expect(forgetNotesInWorkspace(ws, () => false)).toBe(ws);
  });
});

describe('pinning', () => {
  it('pins a tab, which moves it to the end of the pinned ones', () => {
    const ws = pinTab(threeTabs(), { pane: 0, id: 't3' });
    expect(idsOf(ws)).toEqual(['t3', 't1', 't2']);
    expect(ws.panes[0]!.tabs[0]!.pinned).toBe(true);
    const two = pinTab(ws, { pane: 0, id: 't2' });
    expect(idsOf(two)).toEqual(['t3', 't2', 't1']);
  });

  it('unpins a tab, which moves it to the front of the unpinned ones', () => {
    const ws = pinTab(pinTab(threeTabs(), { pane: 0, id: 't3' }), { pane: 0, id: 't2' });
    const un = unpinTab(ws, { pane: 0, id: 't3' });
    expect(idsOf(un)).toEqual(['t2', 't3', 't1']);
    expect(un.panes[0]!.tabs[1]!.pinned).toBe(false);
  });

  it('cannot close a pinned tab', () => {
    const ws = pinTab(threeTabs(), { pane: 0, id: 't3' });
    expect(closeTab(ws, { pane: 0, id: 't3' })).toBe(ws);
  });

  it('keeps pinned tabs first: a new tab or a reorder never lands among them', () => {
    const pinned = pinTab(activateTab(threeTabs(), { pane: 0, id: 't3' }), { pane: 0, id: 't3' });
    expect(idsOf(openInNewTab(pinned, today))).toEqual(['t3', 't4', 't1', 't2']);
    expect(idsOf(reorderTab(pinned, { pane: 0, id: 't1', to: 0 }))).toEqual(['t3', 't1', 't2']);
    expect(idsOf(reorderTab(pinned, { pane: 0, id: 't3', to: 2 }))).toEqual(['t3', 't1', 't2']);
  });

  it('refuses to pin or unpin a tab that is not there, and is a no-op when already so', () => {
    const ws = threeTabs();
    expect(pinTab(ws, { pane: 0, id: 't9' })).toBe(ws);
    expect(unpinTab(ws, { pane: 0, id: 't1' })).toBe(ws);
    const pinned = pinTab(ws, { pane: 0, id: 't1' });
    expect(pinTab(pinned, { pane: 0, id: 't1' })).toBe(pinned);
  });
});

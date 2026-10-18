import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { NO_HISTORY, type NavigationPlace } from './navigation-history.ts';
import { MAX_PANES } from './pane-layout.ts';
import {
  activateNth,
  activateTab,
  CLOSED_LIMIT,
  closePaneInWorkspace,
  closeTab,
  EMPTY_WORKSPACE,
  focusPaneInWorkspace,
  followMoveInWorkspace,
  forgetNotesInWorkspace,
  goBackInTab,
  goForwardInTab,
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
  unpinTab,
  type Tab,
  type Workspace,
} from './workspace.ts';

/**
 * Adversarial attack on PR #337 (tab model). Seeded, edge-biased operation
 * sequences, plus targeted repros for each invariant in tab-model.md §2.
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const NOTES = ['Orchard', 'Kettle', 'Lantern'].map((name) => createVaultPath(`${name}.md`));
const note = (at: number): NavigationPlace => ({ kind: 'note', path: NOTES[at]! });
const PLACES: readonly NavigationPlace[] = [
  ...NOTES.map((path): NavigationPlace => ({ kind: 'note', path })),
  { kind: 'graph', scope: { kind: 'note', path: NOTES[1]!, depth: 2 } },
  { kind: 'inbox' },
];

/** Numbers a caller might plausibly pass by mistake, weighted towards the edges. */
const EDGE_NUMBERS = [0, 1, -1, 2, 3, 9, 10, -0, 0.5, 1.5, NaN, Infinity, -Infinity, 1e9, -1e9];

type Pick = <T>(from: readonly T[]) => T;
type Step = (ws: Workspace, pick: Pick) => Workspace;

function anyId(ws: Workspace, pick: Pick): string {
  const open = ws.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id));
  return pick([...open, ...open, ...ws.closed.map((tab) => tab.id), 't0', `t${ws.nextId}`, '']);
}

const STEPS: readonly (readonly [string, Step])[] = [
  ['openInActiveTab', (ws, pick) => openInActiveTab(ws, pick(PLACES))],
  [
    'openInActiveTabOf',
    (ws, pick) => openInActiveTabOf(ws, { pane: pick(EDGE_NUMBERS), place: pick(PLACES) }),
  ],
  ['openInNewTab', (ws, pick) => openInNewTab(ws, pick(PLACES))],
  ['openInSplit', (ws, pick) => openInSplit(ws, pick(PLACES))],
  ['newTab', (ws) => newTab(ws)],
  ['closeTab', (ws, pick) => closeTab(ws, { pane: pick(EDGE_NUMBERS), id: anyId(ws, pick) })],
  [
    'closeTab(valid)',
    (ws, pick) => {
      const pane = pick(ws.panes.map((_, at) => at));
      return closeTab(ws, { pane, id: pick(ws.panes[pane]!.tabs).id });
    },
  ],
  ['reopenClosedTab', (ws) => reopenClosedTab(ws)],
  ['activateTab', (ws, pick) => activateTab(ws, { pane: pick(EDGE_NUMBERS), id: anyId(ws, pick) })],
  ['nextTab', (ws) => nextTab(ws)],
  ['previousTab', (ws) => previousTab(ws)],
  ['activateNth', (ws, pick) => activateNth(ws, pick(EDGE_NUMBERS))],
  [
    'reorderTab',
    (ws, pick) =>
      reorderTab(ws, { pane: pick(EDGE_NUMBERS), id: anyId(ws, pick), to: pick(EDGE_NUMBERS) }),
  ],
  [
    'moveTabToPane',
    (ws, pick) =>
      moveTabToPane(ws, {
        id: anyId(ws, pick),
        from: pick(EDGE_NUMBERS),
        to: pick(EDGE_NUMBERS),
        at: pick(EDGE_NUMBERS),
      }),
  ],
  [
    'moveTabToPane(valid)',
    (ws, pick) => {
      const from = pick(ws.panes.map((_, at) => at));
      return moveTabToPane(ws, {
        id: pick(ws.panes[from]!.tabs).id,
        from,
        to: 1 - from,
        at: pick(EDGE_NUMBERS),
      });
    },
  ],
  ['splitWithTab', (ws) => splitWithTab(ws)],
  ['closePaneInWorkspace', (ws, pick) => closePaneInWorkspace(ws, pick(EDGE_NUMBERS))],
  ['focusPaneInWorkspace', (ws, pick) => focusPaneInWorkspace(ws, pick(EDGE_NUMBERS))],
  ['goBackInTab', (ws) => goBackInTab(ws)],
  ['goForwardInTab', (ws) => goForwardInTab(ws)],
  [
    'forgetNotesInWorkspace(one)',
    (ws, pick) => {
      const gone = pick(NOTES);
      return forgetNotesInWorkspace(ws, (path) => path === gone);
    },
  ],
  ['forgetNotesInWorkspace(all)', (ws) => forgetNotesInWorkspace(ws, () => true)],
  ['pinTab', (ws, pick) => pinTab(ws, { pane: pick(EDGE_NUMBERS), id: anyId(ws, pick) })],
  [
    'pinTab(valid)',
    (ws, pick) => {
      const pane = pick(ws.panes.map((_, at) => at));
      return pinTab(ws, { pane, id: pick(ws.panes[pane]!.tabs).id });
    },
  ],
  ['unpinTab', (ws, pick) => unpinTab(ws, { pane: pick(EDGE_NUMBERS), id: anyId(ws, pick) })],
];

function allTabs(ws: Workspace): Tab[] {
  return [...ws.panes.flatMap((pane) => pane.tabs), ...ws.closed];
}

function brokenInvariant(ws: Workspace): string | null {
  if (ws.panes.length < 1 || ws.panes.length > MAX_PANES) return `pane count ${ws.panes.length}`;
  if (!Number.isInteger(ws.focused) || ws.focused < 0 || ws.focused >= ws.panes.length) {
    return `focused ${ws.focused}`;
  }
  for (const pane of ws.panes) {
    if (pane.tabs.length === 0) return 'empty pane';
    if (!pane.tabs.some((tab) => tab.id === pane.active))
      return `active ${pane.active} not in pane`;
    const flags = pane.tabs.map((tab) => tab.pinned);
    if (flags.lastIndexOf(true) > flags.indexOf(false) && flags.includes(false)) {
      return 'pinned tab after an unpinned one';
    }
  }
  const ids = allTabs(ws).map((tab) => tab.id);
  if (new Set(ids).size !== ids.length) return `duplicate ids ${ids.join(',')}`;
  if (ws.closed.length > CLOSED_LIMIT) return 'closed stack over the limit';
  if (!Number.isSafeInteger(ws.nextId)) return `nextId ${ws.nextId}`;
  return null;
}

/** Runs seeded sequences, handing each (before, after) pair to `check`. */
function runSequences(
  check: (before: Workspace, after: Workspace, name: string) => string | null,
  { seeds = 150, steps = 60 }: { seeds?: number; steps?: number } = {},
): void {
  for (let seed = 1; seed <= seeds; seed += 1) {
    const random = seeded(seed * 7919);
    const pick: Pick = (from) => from[Math.floor(random() * from.length)]!;
    let ws = EMPTY_WORKSPACE;
    const trail: string[] = [];
    for (let step = 0; step < steps; step += 1) {
      const [name, apply] = pick(STEPS);
      trail.push(name);
      const next = apply(ws, pick);
      const broken = check(ws, next, name);
      if (broken !== null) {
        throw new Error(`seed ${seed}, step ${step} (${name}): ${broken}\n${trail.join(' → ')}`);
      }
      ws = next;
    }
  }
}

describe('attack-337: workspace under edge-biased random sequences', () => {
  it('every result satisfies the invariants', { timeout: 30_000 }, () => {
    runSequences((_before, after) => brokenInvariant(after));
  });

  it('nextId never decreases', { timeout: 30_000 }, () => {
    runSequences((before, after) =>
      after.nextId < before.nextId ? `nextId ${before.nextId} → ${after.nextId}` : null,
    );
  });

  it('an id that has left the workspace never comes back', { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const random = seeded(seed * 104_729);
      const pick: Pick = (from) => from[Math.floor(random() * from.length)]!;
      let ws = EMPTY_WORKSPACE;
      const retired = new Set<string>();
      for (let step = 0; step < 60; step += 1) {
        const [name, apply] = pick(STEPS);
        const next = apply(ws, pick);
        const live = new Set(allTabs(next).map((tab) => tab.id));
        for (const id of live) {
          if (retired.has(id)) throw new Error(`seed ${seed} step ${step} (${name}): ${id} reused`);
        }
        for (const tab of allTabs(ws)) if (!live.has(tab.id)) retired.add(tab.id);
        ws = next;
      }
    }
  });

  it(
    'an operation that changes nothing returns the same object (followMove aside)',
    { timeout: 30_000 },
    () => {
      runSequences((before, after) =>
        after !== before && JSON.stringify(after) === JSON.stringify(before)
          ? 'equal content in a new object'
          : null,
      );
    },
  );
});

describe('attack-337: targeted edges', () => {
  it('followMoveInWorkspace with a move that touches no tab returns the same workspace', () => {
    const ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    const move = { from: createVaultPath('Elsewhere.md'), to: createVaultPath('Moved.md') };
    expect(followMoveInWorkspace(ws, move)).toBe(ws);
  });

  it('followMoveInWorkspace follows a rename chain A→B→C in open and closed tabs', () => {
    let ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    ws = openInNewTab(ws, note(0));
    ws = closeTab(ws, { pane: 0, id: ws.panes[0]!.active });
    const b = createVaultPath('Renamed once.md');
    const c = createVaultPath('Renamed twice.md');
    ws = followMoveInWorkspace(ws, { from: NOTES[0]!, to: b });
    ws = followMoveInWorkspace(ws, { from: b, to: c });
    expect(ws.panes[0]!.tabs[0]!.history.current).toEqual({ kind: 'note', path: c });
    expect(ws.closed[0]!.history.current).toEqual({ kind: 'note', path: c });
  });

  it('forgetNotesInWorkspace leaves an untouched empty tab open (it was not emptied by the delete)', () => {
    // t1: Kettle with Back to Orchard. t2: an empty tab the user made with +.
    let ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    ws = openInActiveTab(ws, note(1));
    ws = newTab(ws);
    const emptyId = ws.panes[0]!.active;
    const after = forgetNotesInWorkspace(ws, (path) => path === NOTES[0]);
    expect(after.panes[0]!.tabs.map((tab) => tab.id)).toContain(emptyId);
  });

  it('forgetNotesInWorkspace keeps a split whose second pane is a fresh empty tab', () => {
    let ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    ws = openInActiveTab(ws, note(1));
    ws = splitWithTab(ws);
    ws = newTab(ws);
    ws = closeTab(ws, { pane: 1, id: ws.panes[1]!.tabs[0]!.id });
    expect(ws.panes).toHaveLength(2);
    const after = forgetNotesInWorkspace(ws, (path) => path === NOTES[0]);
    expect(after.panes).toHaveLength(2);
  });

  it('forgetting every note in every tab keeps pinned tabs, leaves a valid workspace, empties the closed stack', () => {
    let ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    ws = openInNewTab(ws, note(1));
    ws = pinTab(ws, { pane: 0, id: ws.panes[0]!.active });
    ws = openInSplit(ws, note(2));
    ws = openInNewTab(ws, note(0));
    ws = closeTab(ws, { pane: 1, id: ws.panes[1]!.active });
    const pinnedId = ws.panes[0]!.tabs[0]!.id;
    const after = forgetNotesInWorkspace(ws, () => true);
    expect(brokenInvariant(after)).toBeNull();
    expect(after.panes.flatMap((pane) => pane.tabs).some((tab) => tab.id === pinnedId)).toBe(true);
    expect(after.closed).toEqual([]);
  });

  it('back after a forget never lands on a gone note', () => {
    let ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    ws = openInActiveTab(ws, note(1));
    ws = openInActiveTab(ws, note(0));
    ws = openInActiveTab(ws, note(2));
    ws = forgetNotesInWorkspace(ws, (path) => path === NOTES[2]);
    const seen: (NavigationPlace | null)[] = [];
    for (let step = 0; step < 5; step += 1) {
      ws = goBackInTab(ws);
      seen.push(ws.panes[0]!.tabs[0]!.history.current);
    }
    for (let step = 0; step < 5; step += 1) {
      ws = goForwardInTab(ws);
      seen.push(ws.panes[0]!.tabs[0]!.history.current);
    }
    expect(seen).not.toContainEqual(note(2));
  });

  it('closing the last unpinned tab beside a pinned one keeps the pinned one shown', () => {
    let ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    const pinned = ws.panes[0]!.active;
    ws = pinTab(ws, { pane: 0, id: pinned });
    ws = openInNewTab(ws, note(1));
    ws = closeTab(ws, { pane: 0, id: ws.panes[0]!.active });
    expect(ws.panes[0]!.tabs.map((tab) => tab.id)).toEqual([pinned]);
    expect(ws.panes[0]!.active).toBe(pinned);
    expect(closeTab(ws, { pane: 0, id: pinned })).toBe(ws);
  });

  it('moving a pinned only-tab out of a split pane collapses the split and keeps it pinned', () => {
    let ws = splitWithTab(openInActiveTab(EMPTY_WORKSPACE, note(0)));
    const moving = ws.panes[1]!.tabs[0]!.id;
    ws = pinTab(ws, { pane: 1, id: moving });
    ws = moveTabToPane(ws, { id: moving, from: 1, to: 0, at: 99 });
    expect(ws.panes).toHaveLength(1);
    expect(ws.panes[0]!.tabs[0]).toMatchObject({ id: moving, pinned: true });
    expect(ws.focused).toBe(0);
  });

  it('moving the only tab of the only pane to itself changes nothing', () => {
    expect(moveTabToPane(EMPTY_WORKSPACE, { id: 't1', from: 0, to: 0, at: 5 })).toBe(
      EMPTY_WORKSPACE,
    );
  });

  it('splitWithTab at MAX_PANES returns the same workspace and mints no id', () => {
    let ws = EMPTY_WORKSPACE;
    for (let at = 1; at < MAX_PANES; at += 1) ws = splitWithTab(ws);
    expect(splitWithTab(ws)).toBe(ws);
  });

  it('reopenClosedTab after its pane was closed lands in the focused pane with its id and history', () => {
    let ws = openInSplit(openInActiveTab(EMPTY_WORKSPACE, note(0)), note(1));
    ws = openInNewTab(ws, note(2));
    const closing = ws.panes[1]!.active;
    const history = ws.panes[1]!.tabs.find((tab) => tab.id === closing)!.history;
    ws = closeTab(ws, { pane: 1, id: closing });
    ws = closePaneInWorkspace(ws, 1);
    // The closed pane's own tab went onto the stack above it (review item 4
    // on #337), so it takes two reopens to reach the tab closed by hand.
    ws = reopenClosedTab(reopenClosedTab(ws));
    expect(ws.panes).toHaveLength(1);
    expect(ws.panes[0]!.active).toBe(closing);
    expect(ws.panes[0]!.tabs.find((tab) => tab.id === closing)!.history).toBe(history);
  });

  it.each([0, -1, 10, NaN, Infinity, -Infinity, 1.5, 1e9])('activateNth(%s) is a no-op', (n) => {
    const ws = openInNewTab(openInNewTab(EMPTY_WORKSPACE, note(0)), note(1));
    expect(activateNth(ws, n)).toBe(ws);
  });

  it.each([NaN, Infinity, -Infinity, 0.5, 2.5])('reorderTab to %s is a no-op', (to) => {
    const ws = openInNewTab(openInNewTab(EMPTY_WORKSPACE, note(0)), note(1));
    expect(reorderTab(ws, { pane: 0, id: 't1', to })).toBe(ws);
  });

  it('reorderTab to -0 or a huge index clamps to the ends', () => {
    const ws = openInNewTab(openInNewTab(EMPTY_WORKSPACE, note(0)), note(1));
    const ids = (w: Workspace) => w.panes[0]!.tabs.map((tab) => tab.id);
    expect(ids(reorderTab(ws, { pane: 0, id: 't1', to: 1e9 })).at(-1)).toBe('t1');
    expect(
      ids(
        reorderTab(reorderTab(ws, { pane: 0, id: 't1', to: 1e9 }), { pane: 0, id: 't1', to: -0 }),
      )[0],
    ).toBe('t1');
  });

  it('a tab with no place and no history after forget, when pinned, is never closed', () => {
    let ws = openInActiveTab(EMPTY_WORKSPACE, note(0));
    ws = pinTab(ws, { pane: 0, id: 't1' });
    const after = forgetNotesInWorkspace(ws, () => true);
    expect(after.panes[0]!.tabs).toEqual([{ id: 't1', pinned: true, history: NO_HISTORY }]);
  });
});

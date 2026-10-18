import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { NavigationPlace } from './navigation-history.ts';
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
  type Workspace,
} from './workspace.ts';

/**
 * The invariants of docs/design/tab-model.md §2, held across thousands of
 * random operation sequences. Seeded, so a failure is the same failure
 * every run: the seed and the step are in the message.
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

const NOTES = ['Acme', 'Beta', 'Gamma', 'Delta'].map((name) => createVaultPath(`${name}.md`));
const PLACES: readonly NavigationPlace[] = [
  ...NOTES.map((path): NavigationPlace => ({ kind: 'note', path })),
  { kind: 'today' },
  { kind: 'type', name: 'task' },
  { kind: 'graph', scope: { kind: 'note', path: NOTES[0]!, depth: 1 } },
];

type Step = (
  ws: Workspace,
  pick: <T>(from: readonly T[]) => T,
  int: (max: number) => number,
) => Workspace;

/** Every operation, with arguments that may or may not be valid: a refusal is a result too. */
const STEPS: readonly (readonly [string, Step])[] = [
  ['openInActiveTab', (ws, pick) => openInActiveTab(ws, pick(PLACES))],
  [
    'openInActiveTabOf',
    (ws, pick, int) => openInActiveTabOf(ws, { pane: int(3) - 1, place: pick(PLACES) }),
  ],
  ['openInNewTab', (ws, pick) => openInNewTab(ws, pick(PLACES))],
  ['openInSplit', (ws, pick) => openInSplit(ws, pick(PLACES))],
  ['newTab', (ws) => newTab(ws)],
  ['closeTab', (ws, pick, int) => closeTab(ws, { pane: int(3) - 1, id: anyId(ws, pick) })],
  ['reopenClosedTab', (ws) => reopenClosedTab(ws)],
  ['activateTab', (ws, pick, int) => activateTab(ws, { pane: int(3) - 1, id: anyId(ws, pick) })],
  ['nextTab', (ws) => nextTab(ws)],
  ['previousTab', (ws) => previousTab(ws)],
  ['activateNth', (ws, _pick, int) => activateNth(ws, int(11) - 1)],
  [
    'reorderTab',
    (ws, pick, int) => reorderTab(ws, { pane: int(3) - 1, id: anyId(ws, pick), to: int(8) - 2 }),
  ],
  [
    'moveTabToPane',
    (ws, pick, int) =>
      moveTabToPane(ws, { id: anyId(ws, pick), from: int(3) - 1, to: int(3) - 1, at: int(8) - 2 }),
  ],
  ['splitWithTab', (ws) => splitWithTab(ws)],
  ['closePaneInWorkspace', (ws, _pick, int) => closePaneInWorkspace(ws, int(3) - 1)],
  ['focusPaneInWorkspace', (ws, _pick, int) => focusPaneInWorkspace(ws, int(3) - 1)],
  ['goBackInTab', (ws) => goBackInTab(ws)],
  ['goForwardInTab', (ws) => goForwardInTab(ws)],
  [
    'followMoveInWorkspace',
    (ws, pick) => followMoveInWorkspace(ws, { from: pick(NOTES), to: pick(NOTES) }),
  ],
  [
    'forgetNotesInWorkspace',
    (ws, pick) => {
      const gone = pick(NOTES);
      return forgetNotesInWorkspace(ws, (path) => path === gone);
    },
  ],
  ['pinTab', (ws, pick, int) => pinTab(ws, { pane: int(3) - 1, id: anyId(ws, pick) })],
  ['unpinTab', (ws, pick, int) => unpinTab(ws, { pane: int(3) - 1, id: anyId(ws, pick) })],
];

/** An id that is open, closed, or made up. */
function anyId(ws: Workspace, pick: <T>(from: readonly T[]) => T): string {
  const open = ws.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id));
  return pick([...open, ...ws.closed.map((tab) => tab.id), 't0', `t${ws.nextId}`]);
}

function checkInvariants(ws: Workspace): void {
  expect(ws.panes.length).toBeGreaterThanOrEqual(1);
  expect(ws.panes.length).toBeLessThanOrEqual(MAX_PANES);
  expect(Number.isInteger(ws.focused) && ws.focused >= 0 && ws.focused < ws.panes.length).toBe(
    true,
  );
  for (const pane of ws.panes) {
    expect(pane.tabs.length).toBeGreaterThanOrEqual(1);
    expect(pane.tabs.some((tab) => tab.id === pane.active)).toBe(true);
    const firstUnpinned = pane.tabs.findIndex((tab) => !tab.pinned);
    const lastPinned = pane.tabs.map((tab) => tab.pinned).lastIndexOf(true);
    if (firstUnpinned !== -1 && lastPinned !== -1) expect(lastPinned).toBeLessThan(firstUnpinned);
  }
  const ids = [...ws.panes.flatMap((pane) => pane.tabs), ...ws.closed].map((tab) => tab.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(Number(id.slice(1))).toBeLessThan(ws.nextId);
  expect(ws.closed.length).toBeLessThanOrEqual(CLOSED_LIMIT);
  for (const tab of ws.closed) expect(tab.pinned).toBe(false);
}

describe('the workspace invariants', () => {
  // Ten thousand steps: two seconds on an idle machine, and the explicit
  // timeout is for a loaded one, where the default five has not been enough.
  it('hold after every operation in random sequences', { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = seeded(seed);
      const int = (max: number) => Math.floor(random() * max);
      const pick = <T>(from: readonly T[]): T => from[int(from.length)] as T;
      let ws = EMPTY_WORKSPACE;
      const trail: string[] = [];
      for (let step = 0; step < 50; step += 1) {
        const [name, apply] = pick(STEPS);
        trail.push(name);
        ws = apply(ws, pick, int);
        try {
          checkInvariants(ws);
        } catch (failure) {
          throw new Error(
            `seed ${seed}, step ${step} (${name}): ${String(failure)}\n${trail.join(' → ')}`,
            { cause: failure },
          );
        }
      }
    }
  });

  it('hold on the empty workspace', () => {
    checkInvariants(EMPTY_WORKSPACE);
  });

  it('can tell a broken workspace from a sound one', () => {
    expect(() => checkInvariants({ ...EMPTY_WORKSPACE, focused: 1 })).toThrow();
    expect(() =>
      checkInvariants({
        ...EMPTY_WORKSPACE,
        panes: [{ tabs: [...EMPTY_WORKSPACE.panes[0]!.tabs], active: 't9' }],
      }),
    ).toThrow();
  });
});

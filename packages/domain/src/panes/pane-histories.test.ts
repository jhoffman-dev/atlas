import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { NO_HISTORY, visit, type NavigationPlace } from './navigation-history.ts';
import {
  closeInPaneHistories,
  closePaneHistory,
  freshHistories,
  historyOf,
  splitHistories,
  withHistory,
} from './pane-histories.ts';
import { closeInPanes, SINGLE_PANE, type PaneLayout } from './pane-layout.ts';

const path = (raw: string) => createVaultPath(raw);
const note = (raw: string): NavigationPlace => ({ kind: 'note', path: path(raw) });
const opened = (...raws: string[]) => raws.map(note).reduce(visit, NO_HISTORY);
const layoutOf = (paths: (string | null)[], focused = 0): PaneLayout => ({
  paths: paths.map((raw) => (raw === null ? null : path(raw))),
  focused,
});
const goneAt =
  (...raws: string[]) =>
  (held: VaultPath) =>
    raws.includes(held);

describe('freshHistories and historyOf', () => {
  it('starts every pane with nothing to go back to', () => {
    expect(freshHistories(layoutOf(['A.md', 'B.md']))).toEqual([NO_HISTORY, NO_HISTORY]);
  });

  it('reads a pane with no history yet as an empty one', () => {
    expect(historyOf([], 1)).toBe(NO_HISTORY);
  });
});

describe('withHistory', () => {
  it('replaces one pane’s history and leaves the other alone', () => {
    const left = opened('A.md');
    const right = opened('B.md');
    const next = withHistory([left, NO_HISTORY], { pane: 1, history: right });
    expect(next[0]).toBe(left);
    expect(next[1]).toBe(right);
  });

  it('fills in panes it had no history for', () => {
    const right = opened('B.md');
    expect(withHistory([], { pane: 1, history: right })).toEqual([NO_HISTORY, right]);
  });

  it('hands back the same list when nothing changed', () => {
    const histories = [opened('A.md')];
    expect(withHistory(histories, { pane: 0, history: histories[0] ?? NO_HISTORY })).toBe(
      histories,
    );
  });
});

describe('splitHistories', () => {
  it('gives the new pane a history of its own', () => {
    const left = opened('A.md', 'B.md');
    expect(splitHistories([left], layoutOf(['B.md']))).toEqual([left, NO_HISTORY]);
  });

  it('is a no-op on a window already split, as splitting is', () => {
    const histories = [opened('A.md'), opened('B.md')];
    expect(splitHistories(histories, layoutOf(['A.md', 'B.md']))).toBe(histories);
  });
});

describe('closePaneHistory', () => {
  it('drops the closed pane’s history, so the pane left keeps its own', () => {
    const left = opened('A.md');
    const right = opened('B.md');
    expect(closePaneHistory([left, right], 0)).toEqual([right]);
    expect(closePaneHistory([left, right], 1)).toEqual([left]);
  });

  it('never closes the last pane, nor one that is not there', () => {
    const only = [opened('A.md')];
    expect(closePaneHistory(only, 0)).toBe(only);
    const two = [opened('A.md'), opened('B.md')];
    expect(closePaneHistory(two, 2)).toBe(two);
    expect(closePaneHistory(two, -1)).toBe(two);
  });
});

describe('closeInPaneHistories', () => {
  it('closes the history of the pane closeInPanes closes, and forgets the note in the other', () => {
    const layout = layoutOf(['A.md', 'B.md'], 1);
    const left = opened('B.md', 'A.md');
    const right = opened('A.md', 'B.md');

    const next = closeInPaneHistories([left, right], { layout, gone: goneAt('B.md') });

    // The panes line up with what closeInPanes leaves.
    expect(closeInPanes(layout, goneAt('B.md')).paths).toEqual([path('A.md')]);
    expect(next).toEqual([{ back: [], current: note('A.md'), forward: [] }]);
  });

  it('keeps every pane when none of them holds a deleted note', () => {
    const layout = layoutOf(['A.md', 'C.md']);
    const next = closeInPaneHistories([opened('B.md', 'A.md'), opened('C.md')], {
      layout,
      gone: goneAt('B.md'),
    });
    expect(next.map((history) => history.current)).toEqual([note('A.md'), note('C.md')]);
    expect(next[0]?.back).toEqual([]);
  });

  it('keeps the focused pane’s history when every pane held a deleted note', () => {
    const layout = layoutOf(['B.md', 'B.md'], 1);
    const next = closeInPaneHistories([opened('X.md', 'B.md'), opened('A.md', 'B.md')], {
      layout,
      gone: goneAt('B.md'),
    });
    expect(closeInPanes(layout, goneAt('B.md'))).toBe(SINGLE_PANE);
    expect(next).toEqual([{ back: [note('A.md')], current: null, forward: [] }]);
  });
});

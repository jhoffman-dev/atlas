import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  canClosePane,
  canSplit,
  closePane,
  openBeside,
  focusPane,
  isSplit,
  openInFocused,
  openInPane,
  parseRememberedPanes,
  rememberPanes,
  moveInPanes,
  closeInPanes,
  splitFocused,
  splitPane,
  MAX_PANES,
  SINGLE_PANE,
  type PaneLayout,
} from './pane-layout.ts';

const path = (raw: string) => createVaultPath(raw);
const today = path('today.md');
const board = path('.atlas/views/Board.md');

const split = (): PaneLayout => splitFocused(openInFocused(SINGLE_PANE, today));

describe('a window that is not split', () => {
  it('starts as one empty pane', () => {
    expect(SINGLE_PANE.paths).toEqual([null]);
    expect(SINGLE_PANE.focused).toBe(0);
    expect(isSplit(SINGLE_PANE)).toBe(false);
  });

  it('opens what it is given in the pane it has', () => {
    expect(openInFocused(SINGLE_PANE, today).paths).toEqual([today]);
  });

  it('will not close its last pane, since the next note would have nowhere to go', () => {
    const layout = openInFocused(SINGLE_PANE, today);
    expect(closePane(layout, 0)).toBe(layout);
  });
});

describe('splitting', () => {
  it('gives the new pane the note the focused one holds', () => {
    expect(split().paths).toEqual([today, today]);
  });

  it('moves the focus to the new pane, so the next open lands there', () => {
    expect(split().focused).toBe(1);
  });

  it('splits an empty pane too, rather than doing nothing visible', () => {
    const layout = splitFocused(SINGLE_PANE);
    expect(layout.paths).toEqual([null, null]);
    expect(isSplit(layout)).toBe(true);
  });

  it('stops at two, and says so by changing nothing', () => {
    const two = split();
    expect(splitFocused(two)).toBe(two);
    expect(MAX_PANES).toBe(2);
  });
});

describe('splitting a named pane — its own Split button', () => {
  it('splits that pane as the focused one would be, focusing the new pane', () => {
    const one = openInFocused(SINGLE_PANE, today);
    expect(splitPane(one, 0)).toEqual({ paths: [today, today], focused: 1 });
  });

  it('refuses a pane that is not there, rather than splitting another', () => {
    const one = openInFocused(SINGLE_PANE, today);
    expect(splitPane(one, 1)).toBe(one);
    expect(splitPane(one, -1)).toBe(one);
  });

  it('stops at two, as every split does', () => {
    const two = split();
    expect(splitPane(two, 0)).toBe(two);
  });
});

describe('where an open lands', () => {
  it('replaces the focused pane and leaves the other one alone', () => {
    const opened = openInFocused(split(), board);
    expect(opened.paths).toEqual([today, board]);
  });

  it('lands in the first pane once that is the focused one', () => {
    const opened = openInFocused(focusPane(split(), 0), board);
    expect(opened.paths).toEqual([board, today]);
  });

  it('empties the focused pane when nothing is opened in it', () => {
    expect(openInFocused(split(), null).paths).toEqual([today, null]);
  });
});

describe('focus', () => {
  it('moves to the pane that was clicked into', () => {
    expect(focusPane(split(), 0).focused).toBe(0);
  });

  it('ignores a pane that is not there, rather than focusing nothing', () => {
    const two = split();
    expect(focusPane(two, 2)).toBe(two);
    expect(focusPane(two, -1)).toBe(two);
    expect(focusPane(two, 1.5)).toBe(two);
  });
});

describe('closing a pane', () => {
  it('leaves the other one holding what it held', () => {
    const two = openInFocused(split(), board);
    expect(closePane(two, 1).paths).toEqual([today]);
    expect(closePane(two, 0).paths).toEqual([board]);
  });

  it('focuses what is left, whichever pane went', () => {
    const two = split();
    expect(closePane(two, 1).focused).toBe(0);
    expect(closePane(two, 0).focused).toBe(0);
  });

  it('ignores a pane that is not there', () => {
    const two = split();
    expect(closePane(two, 5)).toBe(two);
  });
});

describe('a rename', () => {
  it('is followed by every pane holding the note, not only the one that renamed it', () => {
    const renamed = moveInPanes(split(), { from: today, to: path('Tomorrow.md') });
    expect(renamed.paths).toEqual([path('Tomorrow.md'), path('Tomorrow.md')]);
  });

  it('leaves a pane holding something else alone', () => {
    const two = openInFocused(split(), board);
    expect(moveInPanes(two, { from: today, to: path('Tomorrow.md') }).paths).toEqual([
      path('Tomorrow.md'),
      board,
    ]);
  });
});

describe('a folder moving', () => {
  const plan = path('Projects/Atlas/plan.md');
  const elsewhere = path('Projects Old/notes.md');

  it('takes every pane holding a note under it along', () => {
    const two = openInFocused(splitFocused(openInFocused(SINGLE_PANE, plan)), elsewhere);
    const moved = moveInPanes(two, { from: path('Projects'), to: path('Archive/Projects') });
    expect(moved.paths).toEqual([path('Archive/Projects/Atlas/plan.md'), elsewhere]);
  });

  it('keeps an empty pane empty and the focus where it was', () => {
    const two = splitFocused(SINGLE_PANE);
    const moved = moveInPanes(two, { from: path('Projects'), to: path('Archive/Projects') });
    expect(moved).toEqual(two);
  });
});

describe('a delete', () => {
  const gone = (deleted: string) => (held: string) => held === deleted;

  it('empties the only pane when it held the note', () => {
    const one = openInFocused(SINGLE_PANE, today);
    expect(closeInPanes(one, gone(today))).toEqual(SINGLE_PANE);
  });

  it('closes the pane holding it and leaves the other, focused', () => {
    const two = openInFocused(split(), board);
    // Pane 0 holds today, pane 1 (focused) the board.
    expect(closeInPanes(two, gone(today))).toEqual({ paths: [board], focused: 0 });
  });

  it('moves the focus to what is left when the focused pane closes', () => {
    const two = openInFocused(split(), board);
    expect(closeInPanes(two, gone(board))).toEqual({ paths: [today], focused: 0 });
  });

  it('leaves one empty pane when both held deleted notes', () => {
    expect(closeInPanes(split(), gone(today))).toEqual(SINGLE_PANE);
  });

  it('changes nothing when no pane held it', () => {
    const two = openInFocused(split(), board);
    expect(closeInPanes(two, gone('other.md'))).toBe(two);
  });
});

describe('remembering the split', () => {
  const vaultKey = '/Users/j/Vault';

  it('comes back as it was left', () => {
    const layout = openInFocused(split(), board);
    const restored = parseRememberedPanes(rememberPanes({ layout, vaultKey }), vaultKey);
    expect(restored).toEqual(layout);
  });

  it('is not restored into a different vault, where the paths mean nothing', () => {
    const stored = rememberPanes({ layout: split(), vaultKey });
    expect(parseRememberedPanes(stored, '/Users/j/Other')).toBeNull();
  });

  it('reads nothing remembered as nothing, rather than as an error', () => {
    expect(parseRememberedPanes(null, vaultKey)).toBeNull();
    expect(parseRememberedPanes('{}', vaultKey)).toBeNull();
    expect(parseRememberedPanes({ vault: vaultKey }, vaultKey)).toBeNull();
    expect(parseRememberedPanes({ vault: vaultKey, paths: [] }, vaultKey)).toBeNull();
  });

  it('drops a path that could escape the vault, leaving that pane empty', () => {
    const stored = { vault: vaultKey, paths: ['../secrets.md', 'today.md'], focused: 0 };
    expect(parseRememberedPanes(stored, vaultKey)?.paths).toEqual([null, today]);
  });

  it('keeps no more panes than the window can draw', () => {
    const stored = { vault: vaultKey, paths: ['a.md', 'b.md', 'c.md'], focused: 2 };
    const restored = parseRememberedPanes(stored, vaultKey);
    expect(restored?.paths).toHaveLength(MAX_PANES);
    // The focus went with the pane that was dropped, so it falls back to the first.
    expect(restored?.focused).toBe(0);
  });

  it('falls back to the first pane when the remembered focus is nonsense', () => {
    const stored = { vault: vaultKey, paths: ['a.md'], focused: 'second' };
    expect(parseRememberedPanes(stored, vaultKey)?.focused).toBe(0);
  });
});

/**
 * Adversarial pass: the sequences a keyboard shortcut, a stale callback or a
 * store other than `localStorage` can produce.
 */
describe('a pane index that is not there', () => {
  it('does not open the note in another pane instead', () => {
    // Pane 1 was closed, and a link click queued inside it still arrives.
    const single = openInFocused(SINGLE_PANE, today);
    const after = openInPane(single, { pane: 1, path: board });

    // The note being read is left alone, rather than replaced by one that was
    // asked for somewhere else.
    expect(after.paths).toEqual([today]);
    expect(after.focused).toBe(0);
  });

  it('opens in the pane it is given, and works there next', () => {
    const after = openInPane(split(), { pane: 0, path: board });

    expect(after.paths).toEqual([board, today]);
    expect(after.focused).toBe(0);
  });

  it('refuses a pane index that is not a pane at all', () => {
    const was = split();
    for (const pane of [-1, 1.5, Number.NaN]) {
      expect(openInPane(was, { pane, path: board })).toEqual(was);
    }
  });

  it('never leaves the focus on a pane that is not drawn', () => {
    const layout = parseRememberedPanes(
      { vault: 'vault', paths: new Array<string>(MAX_PANES), focused: 1 },
      'vault',
    );
    expect(layout).not.toBeNull();
    // A hole is neither a path nor null, so `focused` points at nothing at all.
    expect(layout?.paths[layout.focused]).toBeNull();
  });

  it('opens what it is given, whatever the remembered panes were', () => {
    const layout = parseRememberedPanes(
      { vault: 'vault', paths: new Array<string>(MAX_PANES), focused: 0 },
      'vault',
    );
    expect(openInFocused(layout as PaneLayout, today).paths[0]).toBe(today);
  });
});

describe('which arranging commands a pane offers', () => {
  it('offers splitting, and not closing, to a single pane', () => {
    const one = openInFocused(SINGLE_PANE, today);
    expect(canSplit(one)).toBe(true);
    expect(canClosePane(one)).toBe(false);
  });

  it('offers closing, and not splitting, once the window is split', () => {
    expect(canSplit(split())).toBe(false);
    expect(canClosePane(split())).toBe(true);
  });

  it('agrees with what splitting and closing actually do', () => {
    const one = openInFocused(SINGLE_PANE, today);
    expect(splitFocused(one) === one).toBe(!canSplit(one));
    expect(closePane(one, 0) === one).toBe(!canClosePane(one));
    const two = split();
    expect(splitFocused(two) === two).toBe(!canSplit(two));
    expect(closePane(two, 0) === two).toBe(!canClosePane(two));
  });
});

describe('closePane, with more panes than the app draws today', () => {
  /**
   * The file says nothing in it counts to two. `Math.min` alone did: it is
   * right for two panes and wrong for three, where closing a pane before the
   * focused one moved the focus onto a different note.
   *
   * These build the layout directly rather than through `splitFocused`, which
   * stops at MAX_PANES — the arithmetic is what is under test, not the cap.
   */
  const three = (focused: number) => ({
    paths: ['a.md', 'b.md', 'c.md'] as unknown as PaneLayout['paths'],
    focused,
  });

  it('keeps the focus on the same note when an earlier pane closes', () => {
    const after = closePane(three(1), 0);
    expect(after.paths).toEqual(['b.md', 'c.md']);
    expect(after.paths[after.focused]).toBe('b.md');
  });

  it('keeps the focus on the same note when a later pane closes', () => {
    const after = closePane(three(0), 2);
    expect(after.paths[after.focused]).toBe('a.md');
  });

  it('moves the focus to what slid into place when the focused pane closes', () => {
    const after = closePane(three(1), 1);
    expect(after.paths).toEqual(['a.md', 'c.md']);
    expect(after.paths[after.focused]).toBe('c.md');
  });

  it('never leaves the focus past the end when the last pane closes', () => {
    const after = closePane(three(2), 2);
    expect(after.focused).toBeLessThan(after.paths.length);
    expect(after.paths[after.focused]).toBe('b.md');
  });
});

describe('openBeside', () => {
  it('splits a single pane and opens the note in the new one, keeping the old', () => {
    const layout = openBeside(openInFocused(SINGLE_PANE, today), board);
    expect(layout).toEqual({ paths: [today, board], focused: 1 });
  });

  it('opens in the other pane of a split, never over the one being read', () => {
    const readingLeft = { ...split(), focused: 0 };
    expect(openBeside(readingLeft, board)).toEqual({ paths: [today, board], focused: 1 });
    const readingRight = split();
    expect(openBeside(readingRight, board)).toEqual({ paths: [board, today], focused: 0 });
  });
});

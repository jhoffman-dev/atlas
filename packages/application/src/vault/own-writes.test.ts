import { describe, expect, it } from 'vitest';
import {
  createOwnWrites,
  isEchoOf,
  noteSavedThrough,
  OWN_WRITE_KEPT_MS,
  type LeftVersion,
} from './own-writes.ts';

const VAULT = '/vaults/larkspur';
const saved: LeftVersion = { kind: 'text', text: '# Plan\n\nShip it.\n', modified: 1_000 };

/** A clock that moves only when the test says. */
function fixedClock(start = 50_000) {
  let now = start;
  return {
    now: () => now,
    move: (by: number) => void (now += by),
  };
}

describe('isEchoOf: what counts as the echo of the app’s own write (#254)', () => {
  it('is the note exactly as the app saved it: the same time and the same bytes', () => {
    expect(isEchoOf(saved, { kind: 'text', text: saved.text, modified: 1_000 })).toBe(true);
  });

  it('is not another program’s save in the same millisecond, which leaves other bytes', () => {
    expect(
      isEchoOf(saved, { kind: 'text', text: '# Plan\n\nShip it later.\n', modified: 1_000 }),
    ).toBe(false);
  });

  it('is not a save on a coarse-clock disk that kept the time and the length', () => {
    // Same length, same second: only the bytes tell the two apart.
    const edited = '# Plan\n\nShip IT.\n';
    expect(edited).toHaveLength(saved.text.length);
    expect(isEchoOf(saved, { kind: 'text', text: edited, modified: 1_000 })).toBe(false);
  });

  it('is not the same bytes at a later time: something wrote the note again', () => {
    expect(isEchoOf(saved, { kind: 'text', text: saved.text, modified: 1_001 })).toBe(false);
  });

  it('is not a note that is gone, a folder now, or could not be read', () => {
    const found = [
      { kind: 'absent' },
      { kind: 'directory', ownContents: true },
      { kind: 'file' },
      { kind: 'unknown' },
    ] as const;
    for (const each of found) expect(isEchoOf(saved, each), each.kind).toBe(false);
  });

  it('is a folder the app made only while all it holds is the app’s own', () => {
    expect(isEchoOf({ kind: 'folder' }, { kind: 'directory', ownContents: true })).toBe(true);
    expect(isEchoOf({ kind: 'folder' }, { kind: 'directory', ownContents: false })).toBe(false);
    for (const kind of ['absent', 'file', 'unknown'] as const) {
      expect(isEchoOf({ kind: 'folder' }, { kind }), kind).toBe(false);
    }
  });

  it('is a path the app moved or trashed only while nothing is there', () => {
    expect(isEchoOf({ kind: 'absent' }, { kind: 'absent' })).toBe(true);
    expect(isEchoOf({ kind: 'absent' }, { kind: 'file' })).toBe(false);
    expect(isEchoOf({ kind: 'absent' }, { kind: 'directory', ownContents: true })).toBe(false);
    expect(isEchoOf({ kind: 'absent' }, { kind: 'unknown' })).toBe(false);
    expect(isEchoOf({ kind: 'absent' }, { kind: 'text', text: '', modified: 1 })).toBe(false);
  });
});

describe('createOwnWrites: what is kept, and for how long', () => {
  it('keeps the last write at a path', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    const later = { ...saved, text: 'later', modified: 2_000 };
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: later });
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Plan.md' })).toEqual(later);
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Other.md' })).toBeNull();
  });

  it('never answers for the same path in another vault', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    expect(ownWrites.leftAt({ vault: '/vaults/quill', path: 'Plan.md' })).toBeNull();
  });

  it('forgets a write once it has been kept for longer than the window', () => {
    const clock = fixedClock();
    const ownWrites = createOwnWrites({ clock });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    clock.move(OWN_WRITE_KEPT_MS);
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Plan.md' })).toEqual(saved);
    clock.move(1);
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Plan.md' })).toBeNull();
    // Gone for good: the clock coming back does not bring it back.
    clock.move(-5_000);
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Plan.md' })).toBeNull();
  });

  it('keeps nothing it cannot date, when the clock has gone back', () => {
    const clock = fixedClock();
    const ownWrites = createOwnWrites({ clock });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    clock.move(-1);
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Plan.md' })).toBeNull();
  });

  it('keeps only the newest writes past its capacity, re-recording one making it new', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock(), capacity: 3 });
    for (const path of ['a.md', 'b.md', 'c.md']) {
      ownWrites.record({ vault: VAULT, path, left: saved });
    }
    ownWrites.record({ vault: VAULT, path: 'a.md', left: saved });
    ownWrites.record({ vault: VAULT, path: 'd.md', left: saved });
    const kept = ['a.md', 'b.md', 'c.md', 'd.md'].filter(
      (path) => ownWrites.leftAt({ vault: VAULT, path }) !== null,
    );
    expect(kept).toEqual(['a.md', 'c.md', 'd.md']);
  });

  it('forgets a path when told', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    ownWrites.forget({ vault: VAULT, path: 'Plan.md' });
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Plan.md' })).toBeNull();
  });
});

describe('createOwnWrites: which writes the index already holds', () => {
  it('holds a write once a refresh that began after it has finished', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Plan.md' })).toBeNull();
    ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite() });
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Plan.md' })).toEqual(saved);
  });

  it('does not hold a write made after the refresh began, nor one in another vault', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    ownWrites.record({ vault: '/vaults/quill', path: 'Plan.md', left: saved });
    const began = ownWrites.lastWrite();
    ownWrites.record({ vault: VAULT, path: 'Later.md', left: saved });
    ownWrites.refreshed({ vault: VAULT, through: began });
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Plan.md' })).toEqual(saved);
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Later.md' })).toBeNull();
    expect(ownWrites.refreshedAt({ vault: '/vaults/quill', path: 'Plan.md' })).toBeNull();
  });

  it('is not set back by a refresh that finishes late, having begun earlier', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite() });
    ownWrites.refreshed({ vault: VAULT, through: 0 });
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Plan.md' })).toEqual(saved);
  });

  it('holds a path again only once the write that replaced it has been refreshed for', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: { kind: 'absent' } });
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Plan.md' })).toBeNull();
    expect(ownWrites.leftAt({ vault: VAULT, path: 'Plan.md' })).toEqual({ kind: 'absent' });
  });

  it('does not hold a write at a note the refresh could not read', () => {
    const ownWrites = createOwnWrites({ clock: fixedClock() });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    ownWrites.record({ vault: VAULT, path: 'Torn.md', left: saved });
    ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite(), unread: ['Torn.md'] });
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Plan.md' })).toEqual(saved);
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Torn.md' })).toBeNull();
    ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite() });
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Torn.md' })).toEqual(saved);
  });

  it('holds nothing past its window, refreshed for or not', () => {
    const clock = fixedClock();
    const ownWrites = createOwnWrites({ clock });
    ownWrites.record({ vault: VAULT, path: 'Plan.md', left: saved });
    ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite() });
    clock.move(OWN_WRITE_KEPT_MS + 1);
    expect(ownWrites.refreshedAt({ vault: VAULT, path: 'Plan.md' })).toBeNull();
  });
});

describe('createOwnWrites.forgetUnder: a folder trashed or moved with all it holds (#264)', () => {
  const recorded = (paths: readonly string[], vault = VAULT) => {
    const writes = createOwnWrites({ clock: fixedClock() });
    for (const path of paths) writes.record({ vault, path, left: saved });
    return writes;
  };
  const left = (writes: ReturnType<typeof createOwnWrites>, path: string, vault = VAULT) =>
    writes.leftAt({ vault, path });

  it('forgets every write inside the folder, at any depth', () => {
    const writes = recorded(['Projects/Larkspur/Plan.md', 'Projects/Larkspur/2026/Budget.md']);
    writes.forgetUnder({ vault: VAULT, path: 'Projects/Larkspur' });
    expect(left(writes, 'Projects/Larkspur/Plan.md')).toBeNull();
    expect(left(writes, 'Projects/Larkspur/2026/Budget.md')).toBeNull();
  });

  it('keeps the folder’s own write, and everything beside it', () => {
    const writes = recorded(['Projects/Larkspur', 'Projects/Other.md', 'Plan.md']);
    writes.forgetUnder({ vault: VAULT, path: 'Projects/Larkspur' });
    expect(left(writes, 'Projects/Larkspur')).toEqual(saved);
    expect(left(writes, 'Projects/Other.md')).toEqual(saved);
    expect(left(writes, 'Plan.md')).toEqual(saved);
  });

  it('matches whole names only: a folder is not every name it begins', () => {
    const writes = recorded(['Projects/Larkspur/Plan.md', 'Projects/Lark.md']);
    writes.forgetUnder({ vault: VAULT, path: 'Projects/Lark' });
    expect(left(writes, 'Projects/Larkspur/Plan.md')).toEqual(saved);
    expect(left(writes, 'Projects/Lark.md')).toEqual(saved);
  });

  it('forgets nothing in another vault', () => {
    const writes = recorded(['Projects/Larkspur/Plan.md'], '/vaults/quill');
    writes.forgetUnder({ vault: VAULT, path: 'Projects/Larkspur' });
    expect(left(writes, 'Projects/Larkspur/Plan.md', '/vaults/quill')).toEqual(saved);
  });
});

describe('noteSavedThrough: the note a save’s temporary stands beside', () => {
  it('names the note for the host’s temporary, in a folder or at the root', () => {
    expect(noteSavedThrough('Projects/.Plan.md.atlas-tmp')).toBe('Projects/Plan.md');
    expect(noteSavedThrough('.Plan.md.atlas-tmp')).toBe('Plan.md');
  });

  it('is null for anything else, the note itself included', () => {
    for (const path of ['Projects/Plan.md', '.Plan.md', 'Plan.md.atlas-tmp', '..atlas-tmp']) {
      expect(noteSavedThrough(path), path).toBeNull();
    }
  });
});

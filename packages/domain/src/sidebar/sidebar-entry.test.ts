import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { classifySidebarNote, orderSidebarEntries, sidebarEntry } from './sidebar-entry.ts';

describe('sidebarEntry', () => {
  it('shows a note by its name, without the extension', () => {
    expect(sidebarEntry(createVaultPath('.atlas/views/Board.md'))).toEqual({
      path: '.atlas/views/Board.md',
      title: 'Board',
      icon: 'doc',
    });
  });

  it('carries the icon it is given', () => {
    expect(sidebarEntry(createVaultPath('Board.md'), 'board').icon).toBe('board');
  });
});

describe('orderSidebarEntries', () => {
  const entries = (...paths: string[]) => paths.map((path) => sidebarEntry(createVaultPath(path)));

  it('orders alphabetically, ignoring case', () => {
    expect(
      orderSidebarEntries(entries('zebra.md', 'Apple.md', 'mango.md')).map((e) => e.title),
    ).toEqual(['Apple', 'mango', 'zebra']);
  });

  it('counts digit runs as numbers, the way the tree does', () => {
    expect(orderSidebarEntries(entries('note10.md', 'note9.md')).map((e) => e.title)).toEqual([
      'note9',
      'note10',
    ]);
  });

  it('lists a note once when both sources found it', () => {
    const board = createVaultPath('.atlas/views/Board.md');
    expect(orderSidebarEntries([sidebarEntry(board), sidebarEntry(board)])).toHaveLength(1);
  });

  it('keeps two notes that share a name but not a path', () => {
    const ordered = orderSidebarEntries(entries('Notes/Board.md', '.atlas/views/Board.md'));
    expect(ordered.map((entry) => entry.path)).toEqual(['.atlas/views/Board.md', 'Notes/Board.md']);
  });

  it('has nothing to order when there are no favourites', () => {
    expect(orderSidebarEntries([])).toEqual([]);
  });
});

describe('classifySidebarNote', () => {
  it('marks a saved view', () => {
    expect(classifySidebarNote({ atlas: 'view', type: 'task' })).toEqual({
      mark: 'view',
      favorite: false,
      icon: 'table',
    });
  });

  it('marks a dashboard', () => {
    expect(classifySidebarNote({ atlas: 'dashboard' })).toEqual({
      mark: 'dashboard',
      favorite: false,
      icon: 'chart',
    });
  });

  it('leaves an ordinary note unmarked', () => {
    expect(classifySidebarNote({ type: 'task' })).toEqual({
      mark: null,
      favorite: false,
      icon: 'doc',
    });
  });

  it('reads the favourite separately: a view can be one too', () => {
    expect(classifySidebarNote({ atlas: 'view', favorite: true })).toEqual({
      mark: 'view',
      favorite: true,
      icon: 'table',
    });
  });

  it('draws a view by how it will be laid out', () => {
    expect(classifySidebarNote({ atlas: 'view', layout: 'board', groupBy: 'status' }).icon).toBe(
      'board',
    );
    expect(classifySidebarNote({ atlas: 'view', layout: 'list' }).icon).toBe('list');
  });

  it('draws a board with nothing to group by as the table it will open as', () => {
    expect(classifySidebarNote({ atlas: 'view', layout: 'board' }).icon).toBe('table');
  });
});

/**
 * Adversarial pass: the two sources feed the sections in whatever order they
 * come back in — the index's rows, then whatever `.atlas` was walked in — so
 * the order of the same set of notes must not depend on the order it arrived.
 */
describe('orderSidebarEntries, given the same notes in a different order', () => {
  const entries = (...paths: string[]) => paths.map((path) => sidebarEntry(createVaultPath(path)));

  it('lists two notes that differ only by case the same way round either way', () => {
    const asFound = entries('Notes.md', 'notes.md');
    const reversed = [...asFound].reverse();

    expect(orderSidebarEntries(reversed).map((entry) => entry.path)).toEqual(
      orderSidebarEntries(asFound).map((entry) => entry.path),
    );
  });

  it('orders accented and unaccented names the same way round either way', () => {
    const asFound = entries('Resume.md', 'Résumé.md');
    const reversed = [...asFound].reverse();

    expect(orderSidebarEntries(reversed).map((entry) => entry.path)).toEqual(
      orderSidebarEntries(asFound).map((entry) => entry.path),
    );
  });
});

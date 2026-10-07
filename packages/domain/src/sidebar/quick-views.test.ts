import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { findQuickViews } from './quick-views.ts';
import { sidebarEntry } from './sidebar-entry.ts';

const views = (...paths: string[]) => paths.map((path) => sidebarEntry(createVaultPath(path)));

describe('findQuickViews', () => {
  it('lifts out Today and Inbox, Today first', () => {
    const found = findQuickViews(views('.atlas/views/Inbox.md', '.atlas/views/Today.md'));
    expect(found.map((view) => [view.id, view.entry.path])).toEqual([
      ['today', '.atlas/views/Today.md'],
      ['inbox', '.atlas/views/Inbox.md'],
    ]);
  });

  it('matches the title whatever its case', () => {
    expect(findQuickViews(views('inbox.md')).map((view) => view.id)).toEqual(['inbox']);
  });

  it('has no row for a view the vault does not have', () => {
    expect(findQuickViews(views('Board.md', 'Today.md')).map((view) => view.id)).toEqual(['today']);
    expect(findQuickViews([])).toEqual([]);
  });

  it('takes the first of two views that share a title', () => {
    const found = findQuickViews(views('.atlas/views/Today.md', 'Plans/Today.md'));
    expect(found).toHaveLength(1);
    expect(found[0]?.entry.path).toBe('.atlas/views/Today.md');
  });

  it('does not match a title that only contains the word', () => {
    expect(findQuickViews(views('Today and tomorrow.md'))).toEqual([]);
  });
});

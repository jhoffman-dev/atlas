import { describe, expect, it } from 'vitest';
import {
  followMoveInHistory,
  forgetNotes,
  NO_HISTORY,
  samePlace,
  visit,
  type NavigationPlace,
} from '../panes/navigation-history.ts';
import { activeSidebarPageOf } from '../sidebar/active-page.ts';
import { createVaultPath } from '../vault/vault-path.ts';

const document = (raw: string): NavigationPlace => ({
  kind: 'document',
  path: createVaultPath(raw),
});
const note = (raw: string): NavigationPlace => ({ kind: 'note', path: createVaultPath(raw) });

describe('a PDF open in the reader as a place', () => {
  it('is the same place as the same file only, and never its note', () => {
    expect(samePlace(document('Library/A.pdf'), document('Library/A.pdf'))).toBe(true);
    expect(samePlace(document('Library/A.pdf'), document('Library/B.pdf'))).toBe(false);
    expect(samePlace(document('Library/A.pdf'), note('Library/A.pdf'))).toBe(false);
  });

  it('follows its file when the file or its folder moves', () => {
    const history = visit(visit(NO_HISTORY, document('Library/A.pdf')), note('Other.md'));
    const moved = followMoveInHistory(history, {
      from: createVaultPath('Library'),
      to: createVaultPath('Reading'),
    });
    expect(moved.back).toEqual([document('Reading/A.pdf')]);
    expect(moved.current).toEqual(note('Other.md'));
  });

  it('is forgotten when its file is deleted', () => {
    const history = visit(visit(NO_HISTORY, note('Other.md')), document('Library/A.pdf'));
    expect(forgetNotes(history, (path) => path === 'Library/A.pdf').current).toBeNull();
  });

  it('marks the file’s own row in Pages', () => {
    expect(activeSidebarPageOf(document('Library/A.pdf'), () => null)).toEqual({
      kind: 'note',
      path: 'Library/A.pdf',
    });
  });
});

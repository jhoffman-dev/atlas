import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { notesAfterOwnMoves } from './own-moves.ts';

const at = createVaultPath;
const CALL = at('Inbox/Call Mara.md');
const FILED = at('Projects/Larkspur/Call Mara.md');
const PAY = at('Inbox/Pay Tobias.md');

describe('notesAfterOwnMoves (#217)', () => {
  it('applies a filing the tree has not caught up with', () => {
    const after = notesAfterOwnMoves([CALL, PAY], [{ from: CALL, to: FILED }]);
    expect(after.notes).toEqual([FILED, PAY]);
    expect(after.unseen).toEqual([{ from: CALL, to: FILED }]);
  });

  it('drops a move the tree shows already, and leaves the notes as they are', () => {
    const notes = [FILED, PAY];
    const after = notesAfterOwnMoves(notes, [{ from: CALL, to: FILED }]);
    expect(after.notes).toBe(notes);
    expect(after.unseen).toEqual([]);
  });

  it('never carries a note made since at the old path onto one already at the new', () => {
    // Filed, then a new note of the same name captured into the Inbox: both are real.
    const notes = [CALL, FILED, PAY];
    const after = notesAfterOwnMoves(notes, [{ from: CALL, to: FILED }]);
    expect(after.notes).toEqual(notes);
    expect(after.unseen).toEqual([]);
  });
});

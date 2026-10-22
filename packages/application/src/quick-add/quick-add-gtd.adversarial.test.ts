/**
 * Adversarial pass on P30-02 (ADR-0029): quick add makes tasks too, and
 * a task it makes is held to the same rules as one changed anywhere else —
 * and Waiting never needs someone to wait on (#202).
 */
import { describe, expect, it } from 'vitest';
import { TASK_TYPE_FILE } from '@dfai/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { quickAddNote } from './quick-add-note.ts';

describe('quickAddNote on a GTD task', () => {
  it('makes a task Waiting with nobody to wait on (#202)', async () => {
    const created: string[] = [];
    const fs = fakeVaultFs({
      createNote: async ({ contents }) => {
        created.push(contents);
        return 0;
      },
    });
    // Status is offered first; Waiting on is offered too, and left empty.
    const made = quickAddNote({
      today: '2026-10-08',
      fs,
      markdown: fakeMarkdown(),
      type: TASK_TYPE_FILE.type,
      name: 'Hear back from Tobias',
      values: { status: 'waiting', waiting_on: '' },
      template: null,
      beside: null,
      notePaths: [],
    });
    await made;
    expect(created).toHaveLength(1);
    expect(created[0]).toContain('status: waiting');
  });
});

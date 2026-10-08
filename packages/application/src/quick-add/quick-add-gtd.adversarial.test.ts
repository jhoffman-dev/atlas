/**
 * Adversarial pass on P30-02 (ADR-0029): the add button makes tasks too, and
 * a task it makes is held to the same rule as one changed anywhere else —
 * Waiting is waiting on someone.
 */
import { describe, expect, it } from 'vitest';
import { TASK_TYPE_FILE } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { quickAddNote } from './quick-add-note.ts';

describe('quickAddNote on a GTD task', () => {
  it('never makes a task Waiting with nobody to wait on', async () => {
    const created: string[] = [];
    const fs = fakeVaultFs({
      createNote: async ({ contents }) => {
        created.push(contents);
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
    await made.catch(() => undefined);
    expect(created.some((contents) => contents.includes('status: waiting'))).toBe(false);
  });
});

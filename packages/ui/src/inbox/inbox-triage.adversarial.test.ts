/**
 * Adversarial pass on #112: what Done writes is what the row shows. A pick
 * the row no longer shows must not be written with the ones it does.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type InboxTask } from '@atlas/domain';
import { asksWhoItWaitsOn, clarificationOf } from './inbox-triage.ts';

const TASK: InboxTask = {
  status: 'inbox',
  project: null,
  waitingOn: null,
  waitingOnNames: '',
  defer: null,
  due: null,
};
const MARA = createVaultPath('People/Mara Quill.md');

describe('clarificationOf — a change of mind about Waiting', () => {
  it('does not write the person once the row no longer asks who it waits on', () => {
    // Waiting picked, Mara Quill picked, then Next Action picked instead: the person picker is gone.
    const draft = { status: 'next-action', waitingOn: MARA } as const;
    expect(asksWhoItWaitsOn(TASK, draft)).toBe(false);
    expect(clarificationOf(TASK, draft)).toEqual({ status: 'next-action' });
  });

  it('does not offer Done for a person alone that the row no longer shows', () => {
    // Waiting, Mara Quill, then back to Inbox: nothing the row shows differs from the task.
    const draft = { status: 'inbox', waitingOn: MARA } as const;
    expect(asksWhoItWaitsOn(TASK, draft)).toBe(false);
    expect(clarificationOf(TASK, draft)).toBeNull();
  });
});

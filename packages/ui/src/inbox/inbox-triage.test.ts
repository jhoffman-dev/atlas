import { describe, expect, it } from 'vitest';
import { createVaultPath, type InboxItem, type InboxTask } from '@atlas/domain';
import { asksWhoItWaitsOn, clarificationOf, rowAfter } from './inbox-triage.ts';

const TASK: InboxTask = {
  status: 'inbox',
  project: createVaultPath('Projects/Atlas.md'),
  waitingOn: null,
  waitingOnNames: '',
  defer: '2026-10-20',
  due: null,
};

describe('clarificationOf', () => {
  it('is null while the row holds nothing, or only what the task already says', () => {
    expect(clarificationOf(TASK, {})).toBeNull();
    expect(
      clarificationOf(TASK, {
        status: 'inbox',
        project: createVaultPath('Projects/Atlas.md'),
        defer: '2026-10-20',
        due: '',
      }),
    ).toBeNull();
  });

  it('names only what differs from the task', () => {
    expect(
      clarificationOf(TASK, {
        status: 'waiting',
        project: createVaultPath('Projects/Atlas.md'),
        waitingOn: createVaultPath('People/Mara Quill.md'),
      }),
    ).toEqual({ status: 'waiting', waitingOn: 'People/Mara Quill.md' });
  });

  it('clears a date the task had and the row emptied, and sets one it changed', () => {
    expect(clarificationOf(TASK, { defer: '', due: '2026-11-02' })).toEqual({
      defer: null,
      due: '2026-11-02',
    });
  });
});

describe('asksWhoItWaitsOn', () => {
  it('is whether the task is Waiting, or the row is making it so', () => {
    expect(asksWhoItWaitsOn(TASK, {})).toBe(false);
    expect(asksWhoItWaitsOn(TASK, { status: 'waiting' })).toBe(true);
    expect(asksWhoItWaitsOn({ ...TASK, status: 'waiting' }, {})).toBe(true);
    expect(asksWhoItWaitsOn({ ...TASK, status: 'waiting' }, { status: 'backlog' })).toBe(false);
  });
});

describe('rowAfter', () => {
  const items = ['Inbox/A.md', 'Inbox/B.md', 'Inbox/C.md'].map(
    (path) => ({ path: createVaultPath(path) }) as InboxItem,
  );
  const after = (path: string) => rowAfter(items, createVaultPath(path));

  it('is the row below, or the one above the last', () => {
    expect(after('Inbox/A.md')).toBe('Inbox/B.md');
    expect(after('Inbox/C.md')).toBe('Inbox/B.md');
  });

  it('is nothing after the only row, and the first row for one not listed', () => {
    expect(rowAfter(items.slice(0, 1), createVaultPath('Inbox/A.md'))).toBeNull();
    expect(after('Inbox/Gone.md')).toBe('Inbox/A.md');
  });
});

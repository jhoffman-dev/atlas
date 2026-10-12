import { describe, expect, it } from 'vitest';
import { WAITING_NEEDS_SOMEONE } from '../gtd/task-rules.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { clarifyPlan, waitingOnRefusal, type Clarification } from './clarify.ts';

/** #112: what clarifying an Inbox row writes, judged whole before anything is. */

const path = (raw: string): VaultPath => createVaultPath(raw);
const TODAY = '2026-10-11';
const NOTES = [
  'Inbox/Call the bank.md',
  'Tasks/Imported.md',
  'Projects/Atlas.md',
  'People/Mara Quill.md',
].map(path);
const TASK = { type: 'task', status: 'inbox' };

const plan = (
  clarification: Clarification,
  { at = 'Inbox/Call the bank.md', properties = TASK as Record<string, unknown> } = {},
) => clarifyPlan({ path: path(at), properties, clarification, notePaths: NOTES, today: TODAY });

describe('clarifyPlan — a task', () => {
  it('writes a status alone, and files nothing: a single action needs no project', () => {
    expect(plan({ status: 'next-action' })).toEqual({
      changes: { status: 'next-action' },
      fileUnder: null,
    });
  });

  it('writes Waiting and who it waits on as one change, the person linked by name', () => {
    expect(plan({ status: 'waiting', waitingOn: path('People/Mara Quill.md') })).toEqual({
      changes: { status: 'waiting', waiting_on: '[[Mara Quill]]' },
      fileUnder: null,
    });
  });

  it('refuses Waiting with nobody to wait on, in the task rules’ own words', () => {
    expect(plan({ status: 'waiting' })).toEqual({ refused: WAITING_NEEDS_SOMEONE });
  });

  it('lets a task that already says who it waits on be moved to Waiting', () => {
    const waiting = plan(
      { status: 'waiting' },
      { properties: { ...TASK, waiting_on: '[[Mara Quill]]' } },
    );
    expect(waiting).toEqual({ changes: { status: 'waiting' }, fileUnder: null });
  });

  it('refuses taking the person away from a task that is Waiting', () => {
    const waiting = { type: 'task', status: 'waiting', waiting_on: '[[Mara Quill]]' };
    expect(plan({ waitingOn: null }, { properties: waiting })).toEqual({
      refused: WAITING_NEEDS_SOMEONE,
    });
  });

  it('dates a task clarified straight to Archive, as ticking it would', () => {
    expect(plan({ status: 'archive' })).toEqual({
      changes: { status: 'archive', completed: TODAY },
      fileUnder: null,
    });
  });

  it('writes defer, due and contexts; a null or an empty list takes one away', () => {
    expect(
      plan({ defer: '2026-10-20', due: null, contexts: [' @desk ', '', '@desk', '@phone'] }),
    ).toEqual({
      changes: { defer: '2026-10-20', due: null, contexts: ['@desk', '@phone'] },
      fileUnder: null,
    });
    expect(plan({ contexts: [] })).toEqual({ changes: { contexts: null }, fileUnder: null });
  });

  it('refuses a status that is not one of the eight, and a day that is not a day', () => {
    expect(plan({ status: 'done' })).toEqual({
      refused: expect.stringMatching(/“done” is not a status a task can have: Inbox, Backlog,/),
    });
    expect(plan({ due: '2026-02-30' })).toEqual({
      refused: '“2026-02-30” is not a day (YYYY-MM-DD).',
    });
    expect(plan({ defer: 'tomorrow' })).toEqual({
      refused: '“tomorrow” is not a day (YYYY-MM-DD).',
    });
  });

  it('files a task in the Inbox folder under its project, leaving the link to the filing', () => {
    expect(plan({ status: 'next-action', project: path('Projects/Atlas.md') })).toEqual({
      changes: { status: 'next-action' },
      fileUnder: 'Projects/Atlas.md',
    });
    expect(plan({ project: path('Projects/Atlas.md') })).toEqual({
      changes: {},
      fileUnder: 'Projects/Atlas.md',
    });
  });

  it('links a task that lives elsewhere to its project, and leaves it where it is', () => {
    expect(plan({ project: path('Projects/Atlas.md') }, { at: 'Tasks/Imported.md' })).toEqual({
      changes: { project: '[[Atlas]]' },
      fileUnder: null,
    });
  });

  it('refuses a clarification that chooses nothing', () => {
    expect(plan({})).toEqual({ refused: expect.stringMatching(/^Nothing was chosen/) });
  });
});

describe('clarifyPlan — a note that is not a task', () => {
  const MEETING = { type: 'meeting' };

  it('files it, writing nothing of its own', () => {
    expect(plan({ project: path('Projects/Atlas.md') }, { properties: MEETING })).toEqual({
      changes: {},
      fileUnder: 'Projects/Atlas.md',
    });
  });

  it('refuses a status, a wait or a date', () => {
    for (const clarification of [
      { status: 'next-action' },
      { waitingOn: path('People/Mara Quill.md') },
      { due: '2026-10-20' },
    ]) {
      expect(plan(clarification, { properties: MEETING })).toEqual({
        refused: expect.stringMatching(/^Only a task is given a status/),
      });
    }
  });

  it('refuses a proposal, which is answered', () => {
    expect(
      plan({ project: path('Projects/Atlas.md') }, { properties: { type: 'Proposal' } }),
    ).toEqual({
      refused: 'A proposal is answered, not clarified: accept or reject it.',
    });
  });

  it('refuses linking one outside the Inbox folder: only a task waits there', () => {
    expect(
      plan({ project: path('Projects/Atlas.md') }, { at: 'Tasks/Imported.md', properties: {} }),
    ).toEqual({ refused: 'It is not in the Inbox.' });
  });

  it('makes a plain note a task, in the Inbox unless a status is given with it', () => {
    expect(plan({ asTask: true }, { properties: {} })).toEqual({
      changes: { type: 'task', status: 'inbox' },
      fileUnder: null,
    });
    expect(plan({ asTask: true, status: 'someday' }, { properties: {} })).toEqual({
      changes: { type: 'task', status: 'someday' },
      fileUnder: null,
    });
  });

  it('holds a note made a task to the task rules in the same change', () => {
    expect(plan({ asTask: true, status: 'waiting' }, { properties: {} })).toEqual({
      refused: WAITING_NEEDS_SOMEONE,
    });
  });

  it('does not make a note of another type a task, and leaves a task one', () => {
    expect(plan({ asTask: true }, { properties: MEETING })).toEqual({
      refused: 'It is a meeting: only a plain note is made a task.',
    });
    expect(plan({ asTask: true, due: '2026-10-20' })).toEqual({
      changes: { due: '2026-10-20' },
      fileUnder: null,
    });
  });
});

describe('waitingOnRefusal', () => {
  it('lets a task wait on a person, however the type is cased', () => {
    expect(waitingOnRefusal({ path: path('People/Mara Quill.md'), type: 'person' })).toBeNull();
    expect(waitingOnRefusal({ path: path('People/Mara Quill.md'), type: ' Person ' })).toBeNull();
  });

  it('refuses a note of another type, or of none', () => {
    expect(waitingOnRefusal({ path: path('Projects/Atlas.md'), type: 'project' })).toBe(
      'Waiting on links to a person, not a project',
    );
    expect(waitingOnRefusal({ path: path('Notes/Idea.md'), type: null })).toBe(
      'A task waits on a person, and that note is not one.',
    );
  });

  it('refuses an archived person, and one of Atlas’s own files', () => {
    expect(
      waitingOnRefusal({ path: path('Archive/People/Tobias Fenn.md'), type: 'person' }),
    ).toMatch(/archived/);
    expect(waitingOnRefusal({ path: path('.atlas/types/person.md'), type: 'person' })).toMatch(
      /Atlas’s own files/,
    );
  });
});

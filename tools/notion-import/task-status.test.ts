import { describe, expect, it } from 'vitest';
import type { ObjectType, PropertyDef } from '@atlas/domain';
import {
  DEFAULT_TASK_STATUSES,
  GTD_STATUSES,
  isGtdTaskType,
  taskState,
  TaskStatusError,
  taskStatuses,
} from './task-status.ts';

const status = (options: readonly string[], done: string | null = 'archive'): PropertyDef => ({
  key: 'status',
  kind: 'select',
  label: 'Status',
  required: true,
  options: [...options],
  target: null,
  many: false,
  ...(done === null ? {} : { done }),
});

const taskType = (property: PropertyDef): ObjectType => ({
  name: 'task',
  label: 'Task',
  properties: [property],
});

describe("whether the vault's Task type follows GTD", () => {
  it('is so when its status is exactly the eight, in order, finished by Archive', () => {
    expect(isGtdTaskType(taskType(status(GTD_STATUSES)))).toBe(true);
  });

  it('is not so for the old statuses, another order, another done option, or no Task type', () => {
    expect(
      isGtdTaskType(taskType(status(['backlog', 'next', 'doing', 'review', 'done'], 'done'))),
    ).toBe(false);
    expect(isGtdTaskType(taskType(status([...GTD_STATUSES].reverse())))).toBe(false);
    expect(isGtdTaskType(taskType(status(GTD_STATUSES, null)))).toBe(false);
    expect(isGtdTaskType(taskType({ ...status(GTD_STATUSES), kind: 'multiSelect' }))).toBe(false);
    expect(isGtdTaskType(taskType({ ...status(GTD_STATUSES), key: 'stage' }))).toBe(false);
    expect(isGtdTaskType(null)).toBe(false);
  });
});

const TODAY = '2026-10-10';
const state = (notionStatus: string, more: { firstPerson?: string; due?: string } = {}) =>
  taskState(
    { notionStatus, firstPerson: more.firstPerson ?? null, due: more.due ?? null, today: TODAY },
    DEFAULT_TASK_STATUSES,
  );

describe("a Notion task's status, as one of the GTD eight (issue #79)", () => {
  it.each([
    ['Inbox', 'inbox'],
    ['Ready', 'next-action'],
    ['Next Action', 'next-action'],
    ['Later', 'someday'],
    ['In progress', 'in-progress'],
    ['  in   PROGRESS ', 'in-progress'],
  ])('%s is %s', (notion, gtd) => {
    expect(state(notion)).toEqual({
      status: gtd,
      waitingOn: null,
      completed: null,
      scheduled: null,
      note: null,
    });
  });

  it('Waiting waits on the first person in People', () => {
    expect(state('Waiting', { firstPerson: '[[Tobias Fenn]]' })).toMatchObject({
      status: 'waiting',
      waitingOn: '[[Tobias Fenn]]',
      note: null,
    });
  });

  it('Waiting with nobody to wait on is held in the Inbox, and says so', () => {
    expect(state('Waiting')).toMatchObject({
      status: 'inbox',
      waitingOn: null,
      note: 'Waiting with nobody in People: held in the Inbox',
    });
  });

  it('Done is Archive, completed on the day it was found finished', () => {
    expect(state('Done', { due: '2026-12-01' })).toMatchObject({
      status: 'archive',
      completed: TODAY,
      scheduled: null,
    });
  });

  it('a Due date still to come is when the task is scheduled; one today or past is not', () => {
    expect(state('Later', { due: '2026-12-01' }).scheduled).toBe('2026-12-01');
    expect(state('Later', { due: TODAY }).scheduled).toBeNull();
    expect(state('Later', { due: '2026-10-01' }).scheduled).toBeNull();
  });

  it('a status it does not know goes to the Inbox and is listed; no status at all goes quietly', () => {
    expect(state('Blocked')).toMatchObject({
      status: 'inbox',
      note: 'status "Blocked" is not one this import maps: put in the Inbox',
    });
    expect(state(' ')).toMatchObject({ status: 'inbox', note: null });
  });
});

describe('the task mapping, configured', () => {
  it('takes each Notion status=status over the default', () => {
    const statuses = taskStatuses(['Later=longterm', ' On hold = backlog']);
    expect(statuses.get('later')).toBe('longterm');
    expect(statuses.get('on hold')).toBe('backlog');
    expect(statuses.get('ready')).toBe('next-action');
  });

  it('refuses one that is not a status, or names no Notion status', () => {
    expect(() => taskStatuses(['Later=done'])).toThrow(TaskStatusError);
    expect(() => taskStatuses(['Later=done'])).toThrow('"done" is not one of inbox');
    expect(() => taskStatuses(['=inbox'])).toThrow('is not <Notion status>=<status>');
    expect(() => taskStatuses(['inbox'])).toThrow('is not <Notion status>=<status>');
  });
});

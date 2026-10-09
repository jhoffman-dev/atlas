import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  REVIEW_MOVES,
  reviewDeferral,
  weeklyReview,
  type ReviewProject,
  type ReviewTask,
} from './weekly-review.ts';

/** P30-07: the weekly review's sections, each rule on a fixed clock. */
const TODAY = '2026-10-08';
const NOW = Date.UTC(2026, 9, 8, 12);
const DAY = 86_400_000;
const AT = { today: TODAY, now: NOW };

/** A task last looked at `daysAgo` days before now. */
function task(title: string, fields: Partial<ReviewTask> & { daysAgo?: number } = {}): ReviewTask {
  const { daysAgo = 0, ...rest } = fields;
  return {
    path: createVaultPath(`Tasks/${title}.md`),
    title,
    status: 'next-action',
    due: null,
    defer: null,
    waitingOn: '',
    project: null,
    modified: NOW - daysAgo * DAY,
    ...rest,
  };
}

const project = (
  title: string,
  { status = 'active', moving = false }: { status?: string | null; moving?: boolean } = {},
): ReviewProject => ({
  path: createVaultPath(`Projects/${title}.md`),
  title,
  status,
  moving,
});

const titles = (items: readonly { title: string }[]) => items.map((item) => item.title);

const review = (tasks: readonly ReviewTask[], projects: readonly ReviewProject[] = []) =>
  weeklyReview({ tasks, projects, at: AT });

describe('waiting for more than seven days', () => {
  it('lists a Waiting task untouched for more than seven days, the longest waiting first', () => {
    const tasks = [
      task('Quote from Larkspur', { status: 'waiting', waitingOn: 'Mara Quill', daysAgo: 8 }),
      task('Signed lease', { status: 'waiting', waitingOn: 'Tobias Fenn', daysAgo: 20 }),
    ];
    expect(titles(review(tasks).staleWaiting)).toEqual(['Signed lease', 'Quote from Larkspur']);
  });

  it('leaves out one looked at within the week, to the millisecond', () => {
    const seven = task('Exactly a week', { status: 'waiting', modified: NOW - 7 * DAY });
    const past = task('Just over a week', { status: 'waiting', modified: NOW - 7 * DAY - 1 });
    expect(titles(review([seven, past]).staleWaiting)).toEqual(['Just over a week']);
  });

  it('leaves out a task that is not Waiting, however old', () => {
    expect(review([task('Old next action', { daysAgo: 90 })]).staleWaiting).toEqual([]);
  });
});

describe('active projects with no next action', () => {
  it('lists an active project the index says is not moving, by title', () => {
    const projects = [project('Garden'), project('Atlas', { moving: true }), project('Beds')];
    expect(titles(review([], projects).projectsWithoutNextAction)).toEqual(['Beds', 'Garden']);
  });

  it('leaves out a project that is not active', () => {
    const projects = [
      project('Planned', { status: 'planned' }),
      project('Paused', { status: 'paused' }),
      project('None', { status: null }),
    ];
    expect(review([], projects).projectsWithoutNextAction).toEqual([]);
  });

  it('is decided by the project alone, never by which tasks were read', () => {
    const garden = project('Garden', { moving: true });
    expect(review([], [garden]).projectsWithoutNextAction).toEqual([]);
    const atlas = project('Atlas');
    const tasks = [task('Ship the review', { project: atlas.path, status: 'next-action' })];
    expect(titles(review(tasks, [atlas]).projectsWithoutNextAction)).toEqual(['Atlas']);
  });
});

describe('overdue', () => {
  it('lists open tasks due before today, the earliest first', () => {
    const tasks = [
      task('Call the bank', { due: '2026-10-07' }),
      task('Renew passport', { due: '2026-09-01', status: 'backlog' }),
      task('Due today', { due: TODAY }),
      task('Due tomorrow', { due: '2026-10-09' }),
    ];
    expect(titles(review(tasks).overdue)).toEqual(['Renew passport', 'Call the bank']);
  });

  it('counts every committed status, and none of Someday, Longterm, Archive or a status GTD does not know', () => {
    const late = { due: '2026-10-01' };
    const tasks = [
      task('inbox', { ...late, status: 'inbox' }),
      task('backlog', { ...late, status: 'backlog' }),
      task('next-action', { ...late, status: 'next-action' }),
      task('in-progress', { ...late, status: 'in-progress' }),
      task('waiting', { ...late, status: 'waiting' }),
      task('someday', { ...late, status: 'someday' }),
      task('longterm', { ...late, status: 'longterm' }),
      task('archive', { ...late, status: 'archive' }),
      task('unknown', { ...late, status: null }),
    ];
    expect(titles(review(tasks).overdue).sort()).toEqual(
      ['backlog', 'in-progress', 'inbox', 'next-action', 'waiting'].sort(),
    );
  });
});

describe('someday and longterm untouched for more than thirty days', () => {
  it('lists Someday and Longterm tasks untouched for more than thirty days, oldest first', () => {
    const tasks = [
      task('Learn the cello', { status: 'someday', daysAgo: 31 }),
      task('Write a book', { status: 'longterm', daysAgo: 200 }),
      task('Recent idea', { status: 'someday', daysAgo: 29 }),
      task('Thirty exactly', { status: 'someday', modified: NOW - 30 * DAY }),
      task('Old backlog', { status: 'backlog', daysAgo: 200 }),
    ];
    expect(titles(review(tasks).untouchedSomeday)).toEqual(['Write a book', 'Learn the cello']);
  });
});

describe('a deferred task', () => {
  it('is out of every task section until its day, and back on it', () => {
    const later = '2026-10-09';
    const tasks = [
      task('Deferred waiting', { status: 'waiting', daysAgo: 30, defer: later }),
      task('Deferred overdue', { due: '2026-10-01', defer: later }),
      task('Deferred someday', { status: 'someday', daysAgo: 60, defer: later }),
      task('Back today', { status: 'waiting', daysAgo: 30, defer: TODAY }),
    ];
    const sections = review(tasks);
    expect(titles(sections.staleWaiting)).toEqual(['Back today']);
    expect(sections.overdue).toEqual([]);
    expect(sections.untouchedSomeday).toEqual([]);
  });
});

describe('with a fixed clock, a vault of fixtures', () => {
  it('yields exactly the expected items per section', () => {
    const atlas = project('Atlas', { moving: true });
    const garden = project('Garden');
    const tasks = [
      task('Quote from Larkspur', { status: 'waiting', waitingOn: 'Mara Quill', daysAgo: 10 }),
      task('Reply from Tobias', { status: 'waiting', waitingOn: 'Tobias Fenn', daysAgo: 2 }),
      task('Ship the review', { project: atlas.path, due: '2026-10-05' }),
      task('Learn the cello', { status: 'someday', daysAgo: 45 }),
      task('Done long ago', { status: 'archive', due: '2026-01-01', daysAgo: 300 }),
    ];
    expect(review(tasks, [atlas, garden, project('Paused', { status: 'paused' })])).toEqual({
      staleWaiting: [tasks[0]],
      projectsWithoutNextAction: [garden],
      overdue: [tasks[2]],
      untouchedSomeday: [tasks[3]],
    });
  });
});

describe('the quick actions', () => {
  it('defers a task a week from today', () => {
    expect(reviewDeferral(TODAY)).toEqual({ defer: '2026-10-15' });
  });

  it('defers nothing from a day it cannot read', () => {
    expect(reviewDeferral('someday')).toBeNull();
  });

  it('moves a task only to statuses that take it out of its section, never to Archive', () => {
    expect(REVIEW_MOVES.overdue).toEqual(['someday', 'longterm']);
    const all = [
      'inbox',
      'backlog',
      'next-action',
      'in-progress',
      'waiting',
      'someday',
      'longterm',
    ];
    expect(REVIEW_MOVES.staleWaiting).toEqual(all);
    expect(REVIEW_MOVES.untouchedSomeday).toEqual(all);
  });

  it('takes every task moved out of Overdue off the overdue list', () => {
    for (const status of REVIEW_MOVES.overdue) {
      const late = task('Late', { due: '2026-10-01', status });
      expect(review([late]).overdue).toEqual([]);
    }
  });
});

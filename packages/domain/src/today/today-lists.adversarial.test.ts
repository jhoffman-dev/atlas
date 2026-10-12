import { describe, expect, it } from 'vitest';
import { GTD_STATUSES, type GtdStatus } from '../gtd/gtd-status.ts';
import { taskDeferral, type ReviewTask } from '../review/weekly-review.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { todayLists, todayRowOrder, type TodayLists } from './today-lists.ts';

/**
 * Adversarial pass on #111: the page's rule held to its invariants over
 * seeded random vaults — every draw is reproducible from its seed.
 */
const TODAY = '2026-10-12';
const NOW = Date.UTC(2026, 9, 12, 16);
const AT = { today: TODAY, now: NOW };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DAYS = [null, '2025-12-31', '2026-10-11', TODAY, '2026-10-13', '2027-01-01'];
const STATUSES: readonly (GtdStatus | null)[] = [...GTD_STATUSES, null];
const TITLES = ['Call', 'call', 'Écrire', 'Ecrire', 'Zed', ''];
const PEOPLE = ['', 'Mara Quill', 'Tobias Fenn', 'mara quill'];
const PROJECTS = [null, 'Projects/Larkspur Payroll.md', 'Projects/Garden.md', 'Work/Garden.md'];

function randomVault(seed: number, size: number): ReviewTask[] {
  const next = seeded(seed);
  const pick = <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)] as T;
  return Array.from({ length: size }, (_, at) => {
    const project = pick(PROJECTS);
    return {
      path: createVaultPath(`Tasks/${seed}-${at}.md`),
      title: pick(TITLES),
      status: pick(STATUSES),
      due: pick(DAYS),
      defer: pick(DAYS),
      waitingOn: pick(PEOPLE),
      contexts: [],
      project: project === null ? null : createVaultPath(project),
      projectTitle: project === null ? null : 'Garden',
      modified: NOW - Math.floor(next() * 5) * 43_200_000,
    };
  });
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = seeded(seed);
  const copy = [...items];
  for (let at = copy.length - 1; at > 0; at -= 1) {
    const other = Math.floor(next() * (at + 1));
    [copy[at], copy[other]] = [copy[other] as T, copy[at] as T];
  }
  return copy;
}

const rowsOf = (page: TodayLists) =>
  page.sections.flatMap((section) => section.groups.flatMap((group) => group.tasks));

const SEEDS = Array.from({ length: 40 }, (_, at) => at + 1);

describe('todayLists over seeded random vaults', () => {
  it.each(SEEDS)('lists a task at most once, and counts what it lists (seed %i)', (seed) => {
    const page = todayLists({ tasks: randomVault(seed, 60), projects: [], at: AT });
    const paths = todayRowOrder(page);
    expect(new Set(paths).size).toBe(paths.length);
    for (const section of page.sections) {
      const rows = section.groups.reduce((sum, group) => sum + group.tasks.length, 0);
      expect(section.count).toBe(rows);
      expect(section.groups.every((group) => group.tasks.length > 0)).toBe(true);
    }
  });

  it.each(SEEDS)(
    'gives the same page whatever order the index hands tasks in (seed %i)',
    (seed) => {
      const tasks = randomVault(seed, 60);
      const page = todayLists({ tasks, projects: [], at: AT });
      const again = todayLists({ tasks: shuffled(tasks, seed * 7), projects: [], at: AT });
      expect(again).toEqual(page);
    },
  );

  it.each(SEEDS)('leaves the tasks it was given as they were (seed %i)', (seed) => {
    const tasks = randomVault(seed, 30);
    const before = structuredClone(tasks);
    todayLists({ tasks: Object.freeze(tasks), projects: [], at: AT });
    expect(tasks).toEqual(before);
  });

  it.each(SEEDS)('lists no task put off past today (seed %i)', (seed) => {
    const page = todayLists({ tasks: randomVault(seed, 60), projects: [], at: AT });
    expect(rowsOf(page).filter((task) => task.defer !== null && task.defer > TODAY)).toEqual([]);
  });

  it.each(SEEDS)('counts a wait in whole days, never less than none (seed %i)', (seed) => {
    const page = todayLists({ tasks: randomVault(seed, 60), projects: [], at: AT });
    for (const task of rowsOf(page)) {
      if (task.status === 'waiting') expect(task.waitingDays).toBeGreaterThanOrEqual(0);
      else expect(task.waitingDays).toBeNull();
      expect(Number.isInteger(task.waitingDays ?? 0)).toBe(true);
    }
  });
});

describe('todayLists at the turn of the day', () => {
  const task = (given: Partial<ReviewTask>): ReviewTask => ({
    path: createVaultPath('Tasks/Call Mara Quill.md'),
    title: 'Call Mara Quill',
    status: 'next-action',
    due: null,
    defer: null,
    waitingOn: '',
    contexts: [],
    project: null,
    projectTitle: null,
    modified: NOW,
    ...given,
  });
  const sectionOf = (given: Partial<ReviewTask>, today: string) =>
    todayLists({ tasks: [task(given)], projects: [], at: { today, now: NOW } }).sections.find(
      (section) => section.count === 1,
    )?.id ?? null;

  it('turns Due today into Overdue at midnight, and no sooner', () => {
    expect(sectionOf({ due: '2026-10-12' }, '2026-10-12')).toBe('dueToday');
    expect(sectionOf({ due: '2026-10-12' }, '2026-10-13')).toBe('overdue');
    expect(sectionOf({ due: '2026-10-12' }, '2026-10-11')).toBe('nextActions');
  });

  it('holds on the days the clocks change, and across the year', () => {
    for (const day of ['2026-03-08', '2026-11-01', '2026-03-29', '2026-12-31', '2028-02-29']) {
      expect(sectionOf({ due: day }, day)).toBe('dueToday');
      expect(sectionOf({ defer: day, status: 'someday' }, day)).toBe('backToday');
    }
    expect(sectionOf({ due: '2026-12-31' }, '2027-01-01')).toBe('overdue');
  });

  // ADR-0029: Archive leaves every list in one move. The statement leaves finished
  // tasks out, but the rule is the domain's, and a caller with other rows gets no such help.
  it('lists no finished task, though it comes back from deferral today', () => {
    expect(sectionOf({ status: 'archive', defer: TODAY }, TODAY)).toBeNull();
  });

  it('lists a task late and back from deferral today once, as late', () => {
    expect(sectionOf({ due: '2026-10-01', defer: TODAY }, TODAY)).toBe('overdue');
  });

  it('defers by the calendar across a month, a year, a leap day and a clock change', () => {
    const deferred = (today: string, days: number) => taskDeferral({ today, days })?.['defer'];
    expect(deferred('2026-10-31', 1)).toBe('2026-11-01');
    expect(deferred('2026-12-31', 1)).toBe('2027-01-01');
    expect(deferred('2026-12-28', 7)).toBe('2027-01-04');
    expect(deferred('2028-02-28', 1)).toBe('2028-02-29');
    expect(deferred('2027-02-28', 1)).toBe('2027-03-01');
    expect(deferred('2026-03-07', 1)).toBe('2026-03-08');
    expect(deferred('2026-10-31', 7)).toBe('2026-11-07');
    expect(taskDeferral({ today: 'today', days: 1 })).toBeNull();
    expect(taskDeferral({ today: '', days: 7 })).toBeNull();
  });
});

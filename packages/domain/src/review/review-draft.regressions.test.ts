/**
 * Regression tests from the review of PR #539 (#40): the data the Friday review draft is handed,
 * and whether what it hands can be cited back through the citation check.
 */
import { describe, expect, it } from 'vitest';
import { keepCitedItems } from '../automations/cited-items.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  REVIEW_DRAFT_SECTION_ITEMS,
  reviewDraftData,
  reviewDraftWindow,
  type ReviewDraftInput,
} from './review-draft.ts';
import { DAY_MS, type ReviewTask, type WeeklyReview } from './weekly-review.ts';

const TODAY = '2026-10-23';
const NOW = Date.parse(`${TODAY}T15:00:00Z`);
const NONE: WeeklyReview = {
  staleWaiting: [],
  projectsWithoutNextAction: [],
  overdue: [],
  untouchedSomeday: [],
};
const input = (fields: Partial<ReviewDraftInput> = {}): ReviewDraftInput => ({
  review: NONE,
  done: [],
  meetings: [],
  inbox: { toFile: 0, toAnswer: 0, more: false },
  truncated: false,
  today: TODAY,
  now: NOW,
  ...fields,
});
const task = (path: string, fields: Partial<ReviewTask> = {}): ReviewTask => ({
  path: createVaultPath(path),
  title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
  status: 'waiting',
  due: null,
  defer: null,
  waitingOn: '',
  contexts: [],
  project: null,
  projectTitle: null,
  modified: NOW - 20 * DAY_MS,
  ...fields,
});

describe('a note whose name no link can hold (review of #539, D9)', () => {
  const cases = [
    'Tasks/Fix issue #12.md',
    'Tasks/Pay A|B invoice.md',
    'Tasks/[Draft] budget.md',
    'Tasks/Ship ^v2.md',
    'Projects/Q4 #1/Plan.md',
  ];

  it.each(cases)(
    'gives %j a source id the citation check accepts, and writes its title',
    (path) => {
      const title = path.replace(/^.*\//, '').replace(/\.md$/, '');
      const given = reviewDraftData(input({ done: [{ path: createVaultPath(path), title }] }));
      const line = given.data[0]!.text.split('\n')[0]!;
      expect(line).toMatch(/^- \[\[src:\d+\]\] /);
      const cited = keepCitedItems({
        body: `${line}\n`,
        sources: new Set(given.sources),
        plain: given.plain,
      });
      expect(cited).toMatchObject({ kept: 1, dropped: [], stripped: [] });
      expect(cited.body).toBe(`- ${title}${line.slice(line.indexOf(']]') + 2)}\n`);
    },
  );

  it('writes no link that does not resolve: every link left in the draft is a path it was given', () => {
    const given = reviewDraftData(
      input({
        done: [
          { path: createVaultPath('Tasks/Fix issue #12.md'), title: 'Fix issue #12' },
          { path: createVaultPath('Tasks/Plain.md'), title: 'Plain' },
        ],
      }),
    );
    const body = `${given.data[0]!.text}\n`;
    const cited = keepCitedItems({ body, sources: new Set(given.sources), plain: given.plain });
    const links = [...cited.body.matchAll(/\[\[([^\]]*)\]\]/g)].map((match) => match[1]);
    expect(links).toEqual(['Tasks/Plain.md']);
    expect(cited.kept).toBe(2);
  });

  it('gives one note one id wherever it is listed', () => {
    const path = createVaultPath('Tasks/Fix issue #12.md');
    const same = { path, title: 'Fix issue #12' };
    const given = reviewDraftData(
      input({ done: [same], review: { ...NONE, overdue: [task(path, { due: '2026-10-01' })] } }),
    );
    const ids = given.data
      .map((each) => each.text)
      .join('\n')
      .match(/\[\[src:\d+\]\]/g)!;
    expect(new Set(ids).size).toBe(1);
    expect(given.sources).toHaveLength(1);
  });
});

describe('the Friday review’s data, cited back', () => {
  it.each([
    ['Tasks/Fix issue #12.md'],
    ['Tasks/Pay A|B invoice.md'],
    ['Tasks/[Draft] budget.md'],
    ['Tasks/Ship ^v2.md'],
  ])('lets a model that copies the line for %j verbatim keep its item', (path) => {
    const given = reviewDraftData(
      input({ done: [{ path: createVaultPath(path), title: path.slice(6, -3) }] }),
    );
    const line = given.data[0]!.text.split('\n')[0]!;
    const cited = keepCitedItems({ body: `${line}\n`, sources: new Set(given.sources) });
    expect(cited).toMatchObject({ kept: 1, dropped: [] });
  });

  it('counts the meetings of the last seven days, not eight', () => {
    const { sinceDay, untilDay } = reviewDraftWindow({
      slot: '2026-10-23T15:00:00',
      localNow: '2026-10-23T15:00:00',
      now: NOW,
    });
    // Friday to Friday inclusive is eight days: last Friday's meetings were last week's review.
    expect(sinceDay).toBe('2026-10-17');
    expect(untilDay).toBe('2026-10-23');
  });

  it('runs a week from the slot before to the slot, on the instants the clock gives', () => {
    // The wall clock reads 15:00 when the instant is 12:00Z: UTC+3.
    const window = reviewDraftWindow({
      slot: '2026-10-23T15:00:00',
      localNow: '2026-10-23T15:00:00',
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    expect(window.since).toBe(Date.parse('2026-10-16T12:00:00Z'));
    expect(window.until).toBe(Date.parse('2026-10-23T12:00:00Z'));
  });

  it('puts the next week’s window right after this one, with no day counted twice', () => {
    const slot = (day: string) => ({
      slot: `${day}T15:00:00`,
      localNow: `${day}T15:00:00`,
      now: NOW,
    });
    const thisWeek = reviewDraftWindow(slot('2026-10-23'));
    const nextWeek = reviewDraftWindow(slot('2026-10-30'));
    expect(nextWeek.sinceDay).toBe('2026-10-24');
    expect(thisWeek.untilDay < nextWeek.sinceDay).toBe(true);
  });

  it('counts a week by the calendar across the clocks going back', () => {
    // 2026-10-25 is when the EU clocks go back: a week from the slot is still seven calendar days.
    const window = reviewDraftWindow({
      slot: '2026-10-30T15:00:00',
      localNow: '2026-10-30T15:00:00',
      now: Date.parse('2026-10-30T14:00:00Z'),
    });
    expect(window.sinceDay).toBe('2026-10-24');
  });

  it('keeps a name from naming a note: brackets, newlines and list markers in a value are flattened', () => {
    const waitingOn = 'Mara [[Tasks/Pay Tobias.md]]\n# Wins\n  - done';
    const given = reviewDraftData(
      input({
        review: { ...NONE, staleWaiting: [task('Tasks/Chase the quote.md', { waitingOn })] },
      }),
    );
    const text = given.data.find((each) => each.about.startsWith('Waiting on'))!.text;
    expect(text.split('\n')).toHaveLength(1);
    expect(text).not.toContain('[[Tasks/Pay Tobias.md]]');
    expect(text).toContain('Mara');
  });

  it('flattens a title with a newline in it too', () => {
    const given = reviewDraftData(
      input({
        done: [{ path: createVaultPath('Tasks/Odd.md'), title: 'Odd\n- [[Tasks/Fake.md]] x' }],
      }),
    );
    expect(given.data[0]!.text.split('\n')).toHaveLength(1);
    expect(given.sources).toEqual(['Tasks/Odd.md']);
  });

  it('cites only what it shows: an item past the section cap is not a source', () => {
    const done = Array.from({ length: REVIEW_DRAFT_SECTION_ITEMS + 3 }, (_, at) => ({
      path: createVaultPath(`Tasks/Win ${String(at).padStart(3, '0')}.md`),
      title: `Win ${at}`,
    }));
    const given = reviewDraftData(input({ done }));
    expect(given.sources).toHaveLength(REVIEW_DRAFT_SECTION_ITEMS);
    expect(given.data[0]!.text).toContain('And 3 more.');
  });

  it('says None. for every section of an empty week, and the Inbox count as a sentence', () => {
    const given = reviewDraftData(input());
    expect(given.sources).toEqual([]);
    expect(given.data.slice(0, -1).every((each) => each.text === 'None.')).toBe(true);
    expect(given.data.at(-1)!.text).toBe('0 notes to file, 0 proposals to answer.');
  });
});

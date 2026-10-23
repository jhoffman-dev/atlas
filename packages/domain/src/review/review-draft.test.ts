import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  REVIEW_DRAFT_SECTION_ITEMS,
  reviewDraftData,
  reviewDraftWindow,
  type ReviewDraftInput,
} from './review-draft.ts';
import { DAY_MS, type ReviewProject, type ReviewTask, type WeeklyReview } from './weekly-review.ts';

/** #40: what the Friday review draft is handed, each item with the path it must cite. */

const TODAY = '2026-10-23';
const NOW = Date.parse(`${TODAY}T15:00:00Z`);

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
  modified: NOW - 10 * DAY_MS,
  ...fields,
});
const project = (path: string): ReviewProject => ({
  path: createVaultPath(path),
  title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
  status: 'active',
  moving: false,
});
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
const section = (data: ReturnType<typeof reviewDraftData>, about: string) =>
  data.data.find((each) => each.about === about)?.text;

describe('reviewDraftData', () => {
  it('lists each section with the path of every item, and cites only those', () => {
    const data = reviewDraftData(
      input({
        review: {
          staleWaiting: [task('Tasks/Quote.md', { waitingOn: 'Mara Quill' })],
          projectsWithoutNextAction: [project('Projects/Larkspur launch.md')],
          overdue: [task('Tasks/Invoice.md', { status: 'next-action', due: '2026-10-20' })],
          untouchedSomeday: [
            task('Tasks/Learn Rust.md', { status: 'someday', modified: NOW - 45 * DAY_MS }),
          ],
        },
        done: [{ path: createVaultPath('Tasks/Send the file.md'), title: 'Send the file' }],
        meetings: [
          { path: createVaultPath('Meetings/Standup.md'), title: 'Standup', date: '2026-10-21' },
        ],
        inbox: { toFile: 4, toAnswer: 2, more: false },
      }),
    );
    expect(data.data.map(({ about }) => about)).toEqual([
      'Done in the last 7 days',
      'Meetings in the last 7 days',
      'Waiting on someone for more than 7 days',
      'Overdue',
      'Active projects with no next action',
      'Someday, untouched for more than 30 days',
      'The Inbox',
    ]);
    expect(section(data, 'Done in the last 7 days')).toBe(
      '- [[Tasks/Send the file.md]] Send the file',
    );
    expect(section(data, 'Meetings in the last 7 days')).toBe(
      '- [[Meetings/Standup.md]] Standup — 2026-10-21',
    );
    expect(section(data, 'Waiting on someone for more than 7 days')).toBe(
      '- [[Tasks/Quote.md]] Quote — waiting on Mara Quill, untouched for 10 days',
    );
    expect(section(data, 'Overdue')).toBe('- [[Tasks/Invoice.md]] Invoice — due 2026-10-20');
    expect(section(data, 'Active projects with no next action')).toBe(
      '- [[Projects/Larkspur launch.md]] Larkspur launch',
    );
    expect(section(data, 'Someday, untouched for more than 30 days')).toBe(
      '- [[Tasks/Learn Rust.md]] Learn Rust — untouched for 45 days',
    );
    expect(section(data, 'The Inbox')).toBe('4 notes to file, 2 proposals to answer.');
    expect([...data.sources].sort()).toEqual(
      [
        'Meetings/Standup.md',
        'Projects/Larkspur launch.md',
        'Tasks/Invoice.md',
        'Tasks/Learn Rust.md',
        'Tasks/Quote.md',
        'Tasks/Send the file.md',
      ].sort(),
    );
  });

  it('says a section is empty, and who a task waits on when nobody is named', () => {
    const data = reviewDraftData(
      input({ review: { ...NONE, staleWaiting: [task('Tasks/Q.md')] } }),
    );
    expect(section(data, 'Overdue')).toBe('None.');
    expect(section(data, 'Waiting on someone for more than 7 days')).toBe(
      '- [[Tasks/Q.md]] Q — waiting on nobody named, untouched for 10 days',
    );
    expect(data.sources).toEqual(['Tasks/Q.md']);
  });

  it('cuts a long section, says how many more, and cites only what it showed', () => {
    const done = Array.from({ length: REVIEW_DRAFT_SECTION_ITEMS + 3 }, (_, at) => ({
      path: createVaultPath(`Tasks/T${String(at).padStart(3, '0')}.md`),
      title: `T${at}`,
    }));
    const data = reviewDraftData(input({ done }));
    const lines = section(data, 'Done in the last 7 days')!.split('\n');
    expect(lines).toHaveLength(REVIEW_DRAFT_SECTION_ITEMS + 1);
    expect(lines.at(-1)).toBe('And 3 more.');
    expect(data.sources).toHaveLength(REVIEW_DRAFT_SECTION_ITEMS);
    expect(data.sources).not.toContain(done.at(-1)!.path);
  });

  it('cites a note once, though two sections list it', () => {
    const quote = task('Tasks/Quote.md', { due: '2026-10-01' });
    const data = reviewDraftData(
      input({ review: { ...NONE, staleWaiting: [quote], overdue: [quote] } }),
    );
    expect(data.sources).toEqual(['Tasks/Quote.md']);
  });

  it('says when the Inbox holds more than it counted, and when the index held tasks back', () => {
    const data = reviewDraftData(
      input({ inbox: { toFile: 500, toAnswer: 1, more: true }, truncated: true }),
    );
    expect(section(data, 'The Inbox')).toBe(
      'More than 500 notes to file, 1 proposals to answer. The vault holds more tasks than were read: a section may be short.',
    );
  });
});

describe('reviewDraftWindow', () => {
  it('is seven days back: a moment for finished tasks, a calendar day for meetings', () => {
    expect(reviewDraftWindow({ today: TODAY, now: NOW })).toEqual({
      since: NOW - 7 * DAY_MS,
      sinceDay: '2026-10-16',
    });
  });

  it('counts the day on the calendar across a month and a clock change', () => {
    expect(reviewDraftWindow({ today: '2026-11-03', now: 0 }).sinceDay).toBe('2026-10-27');
    expect(reviewDraftWindow({ today: '2026-03-02', now: 0 }).sinceDay).toBe('2026-02-23');
  });
});

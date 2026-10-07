import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { ActivityEvent } from './activity-event.ts';
import {
  ACTIVITY_REPEAT_MS,
  EVERY_ACTIVITY,
  activityRepeatKey,
  activitySeenAt,
  filterActivity,
  newlyShownNotices,
  repeatsActivity,
  unseenErrorCount,
  withKindToggled,
} from './activity-query.ts';

const at = (minute: number) => Date.UTC(2026, 8, 28, 9, minute);

const EVENTS: ActivityEvent[] = [
  {
    at: at(1),
    level: 'info',
    kind: 'automation',
    message: 'Tidy tasks: Ran on schedule. Archived 2 notes.',
    subject: { kind: 'rule', path: createVaultPath('.atlas/automations/Tidy tasks.md') },
  },
  {
    at: at(2),
    level: 'warning',
    kind: 'api',
    message: 'PUT v1/notes/{path}/body refused (conflict).',
    subject: { kind: 'note', path: createVaultPath('Projects/Atlas.md') },
  },
  {
    at: at(3),
    level: 'error',
    kind: 'source',
    message: 'Feed: Refresh failed. 500',
    subject: null,
  },
  {
    at: at(3),
    level: 'info',
    kind: 'index',
    message: 'Rebuilt the index: 40 notes.',
    subject: null,
  },
  { at: at(4), level: 'error', kind: 'save', message: 'Could not save Inbox.md.', subject: null },
];

const messages = (events: readonly ActivityEvent[]) => events.map((event) => event.message);

describe('filterActivity', () => {
  it('shows every line, newest first, with lines of one moment newest-recorded first', () => {
    expect(messages(filterActivity(EVENTS, EVERY_ACTIVITY))).toEqual([
      'Could not save Inbox.md.',
      'Rebuilt the index: 40 notes.',
      'Feed: Refresh failed. 500',
      'PUT v1/notes/{path}/body refused (conflict).',
      'Tidy tasks: Ran on schedule. Archived 2 notes.',
    ]);
  });

  it('shows errors alone', () => {
    const shown = filterActivity(EVENTS, { ...EVERY_ACTIVITY, level: 'errors' });
    expect(shown.map((event) => event.level)).toEqual(['error', 'error']);
  });

  it('shows warnings and errors', () => {
    const shown = filterActivity(EVENTS, { ...EVERY_ACTIVITY, level: 'warnings' });
    expect(shown.map((event) => event.kind)).toEqual(['save', 'source', 'api']);
  });

  it('shows only the kinds chosen', () => {
    const shown = filterActivity(EVENTS, { ...EVERY_ACTIVITY, kinds: ['automation', 'index'] });
    expect(shown.map((event) => event.kind)).toEqual(['index', 'automation']);
  });

  it('combines level and kind', () => {
    const shown = filterActivity(EVENTS, { level: 'errors', kinds: ['source'], text: '' });
    expect(messages(shown)).toEqual(['Feed: Refresh failed. 500']);
  });

  it('finds words in any case and order, in the message, the kind or the subject', () => {
    expect(messages(filterActivity(EVENTS, { ...EVERY_ACTIVITY, text: 'ARCHIVED tidy' }))).toEqual([
      'Tidy tasks: Ran on schedule. Archived 2 notes.',
    ]);
    expect(messages(filterActivity(EVENTS, { ...EVERY_ACTIVITY, text: 'projects/atlas' }))).toEqual(
      ['PUT v1/notes/{path}/body refused (conflict).'],
    );
    expect(filterActivity(EVENTS, { ...EVERY_ACTIVITY, text: 'index' })).toHaveLength(1);
  });

  it('shows nothing when a word is found nowhere', () => {
    expect(filterActivity(EVENTS, { ...EVERY_ACTIVITY, text: 'tidy zebra' })).toEqual([]);
  });

  it('treats a query of spaces as no words', () => {
    expect(filterActivity(EVENTS, { ...EVERY_ACTIVITY, text: '   ' })).toHaveLength(EVENTS.length);
  });
});

describe('unseenErrorCount', () => {
  it('counts every error when the page was never opened', () => {
    expect(unseenErrorCount(EVENTS, null)).toBe(2);
  });

  it('counts only errors after the page was last opened', () => {
    expect(unseenErrorCount(EVENTS, at(3))).toBe(1);
    expect(unseenErrorCount(EVENTS, at(4))).toBe(0);
  });

  it('does not count warnings', () => {
    expect(
      unseenErrorCount(
        EVENTS.filter((event) => event.level !== 'error'),
        null,
      ),
    ).toBe(0);
  });
});

describe('repeatsActivity', () => {
  const first = EVENTS[4] as ActivityEvent;

  it('is the same line again within a minute', () => {
    expect(repeatsActivity(first, { ...first, at: first.at + ACTIVITY_REPEAT_MS - 1 })).toBe(true);
  });

  it('is news again once a minute has passed', () => {
    expect(repeatsActivity(first, { ...first, at: first.at + ACTIVITY_REPEAT_MS })).toBe(false);
  });

  it.each([
    ['level', { level: 'warning' as const }],
    ['kind', { kind: 'app' as const }],
    ['message', { message: 'Could not save Other.md.' }],
    ['subject', { subject: { kind: 'note' as const, path: createVaultPath('Inbox.md') } }],
  ])('is not a repeat when its %s differs', (_name, change) => {
    expect(repeatsActivity(first, { ...first, ...change, at: first.at + 1 })).toBe(false);
  });

  it('compares subjects by kind and path', () => {
    const withSubject = EVENTS[0] as ActivityEvent;
    expect(repeatsActivity(withSubject, { ...withSubject, at: withSubject.at + 1 })).toBe(true);
    const asNote = {
      ...withSubject,
      at: withSubject.at + 1,
      subject: { kind: 'note' as const, path: createVaultPath('.atlas/automations/Tidy tasks.md') },
    };
    expect(repeatsActivity(withSubject, asNote)).toBe(false);
  });
});

describe('newlyShownNotices', () => {
  it('gives the notices that were not on screen a moment ago', () => {
    expect(newlyShownNotices(['a', null], ['a', 'b', null, 'c'])).toEqual(['b', 'c']);
  });

  it('gives none while the same notices stay', () => {
    expect(newlyShownNotices(['a', 'b'], ['b', 'a'])).toEqual([]);
  });

  it('gives a notice again once it went away and came back', () => {
    expect(newlyShownNotices([null], ['a'])).toEqual(['a']);
  });

  it('gives a notice shown in two places once', () => {
    expect(newlyShownNotices([], ['a', 'a'])).toEqual(['a']);
  });
});

describe('withKindToggled', () => {
  it('turns a kind on, then off again, leaving the rest of the query', () => {
    const on = withKindToggled({ level: 'errors', kinds: ['api'], text: 'x' }, 'chat');
    expect(on).toEqual({ level: 'errors', kinds: ['api', 'chat'], text: 'x' });
    expect(withKindToggled(on, 'api')).toEqual({ level: 'errors', kinds: ['chat'], text: 'x' });
  });
});

describe('repeatsActivity when the clock is set back', () => {
  const first = EVENTS[4] as ActivityEvent;

  it('is news again when the clock went back more than a minute', () => {
    expect(repeatsActivity(first, { ...first, at: first.at - ACTIVITY_REPEAT_MS })).toBe(false);
  });

  it('is still a repeat a moment either side', () => {
    expect(repeatsActivity(first, { ...first, at: first.at - 1 })).toBe(true);
  });
});

describe('activityRepeatKey', () => {
  const first = EVENTS[0] as ActivityEvent;

  it('is the same for a line said again at another time', () => {
    expect(activityRepeatKey({ ...first, at: first.at + 5 })).toBe(activityRepeatKey(first));
  });

  it.each([
    ['level', { level: 'warning' as const }],
    ['kind', { kind: 'app' as const }],
    ['message', { message: 'Other' }],
    [
      'subject kind',
      {
        subject: {
          kind: 'note' as const,
          path: createVaultPath('.atlas/automations/Tidy tasks.md'),
        },
      },
    ],
    ['subject path', { subject: { kind: 'rule' as const, path: createVaultPath('Other.md') } }],
    ['subject', { subject: null }],
  ])('differs when the %s differs', (_name, change) => {
    expect(activityRepeatKey({ ...first, ...change })).not.toBe(activityRepeatKey(first));
  });

  it('cannot be made equal by a message that holds the separator', () => {
    const a = { ...first, message: 'a', subject: null };
    const b = { ...first, message: 'a"', subject: null };
    expect(activityRepeatKey(a)).not.toBe(activityRepeatKey(b));
  });
});

describe('activitySeenAt', () => {
  it('is the clock, when every line is older', () => {
    expect(activitySeenAt(EVENTS, at(30))).toBe(at(30));
  });

  it('is the newest line, when it is dated ahead of the clock', () => {
    expect(activitySeenAt(EVENTS, at(0))).toBe(at(4));
  });

  it('is the clock, with no lines', () => {
    expect(activitySeenAt([], at(0))).toBe(at(0));
  });
});

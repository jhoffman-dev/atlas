import { describe, expect, it } from 'vitest';
import type { NoteChange } from '../index/note-changes.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { parseAutomationRule } from './automation-rule.ts';
import {
  deletedHandledNotes,
  handledVersions,
  noteTriggerHears,
  noteTriggerQueryProblem,
  parseNoteTrigger,
  printNoteTrigger,
  triggeringVersions,
  unhandledVersions,
  type NoteTrigger,
} from './note-trigger.ts';
import type { LogEntry } from './run-log.ts';
import { describeSchedule, parseSchedule, printSchedule } from './schedule.ts';

const p = createVaultPath;
const ON_MEETING: NoteTrigger = { kind: 'note', type: 'meeting', on: ['created', 'changed'] };
const MEETING_CREATED: NoteTrigger = { ...ON_MEETING, on: ['created'] };
const MEETING_CHANGED: NoteTrigger = { ...ON_MEETING, on: ['changed'] };

const change = (
  kind: NoteChange['kind'],
  path: string,
  { type = 'meeting' as string | null, digest = `d-${path}` } = {},
): NoteChange => ({ kind, path, type, digest });

describe('parseNoteTrigger', () => {
  it.each([
    ['a meeting is created', MEETING_CREATED],
    ['a meeting is changed', MEETING_CHANGED],
    ['a meeting is created or changed', ON_MEETING],
    ['  A   meeting IS changed or created ', ON_MEETING],
    ['an event is created', { kind: 'note', type: 'event', on: ['created'] }],
    ['a Book_club is changed', { kind: 'note', type: 'Book_club', on: ['changed'] }],
  ])('reads %j', (text, trigger) => expect(parseNoteTrigger(text)).toEqual(trigger));

  it.each([
    'a meeting is deleted',
    'a meeting is',
    'meeting is created',
    'a 2meeting is created',
    'a book club is created',
    'a meeting is created and changed',
    '',
  ])('refuses %j', (text) => expect(parseNoteTrigger(text)).toBeNull());

  it('reads back what it prints, and the schedule reads and prints it too', () => {
    for (const trigger of [ON_MEETING, MEETING_CREATED, MEETING_CHANGED]) {
      expect(parseNoteTrigger(printNoteTrigger(trigger))).toEqual(trigger);
      expect(parseSchedule(printSchedule(trigger))).toEqual(trigger);
    }
    expect(printNoteTrigger({ kind: 'note', type: 'event', on: ['changed'] })).toBe(
      'an event is changed',
    );
    expect(describeSchedule(ON_MEETING)).toBe('When a meeting is created or changed');
  });
});

describe('noteTriggerQueryProblem', () => {
  it('lets through a query that takes notes of the trigger’s type, with others or a where', () => {
    expect(noteTriggerQueryProblem(ON_MEETING, 'FROM meeting')).toBeNull();
    expect(
      noteTriggerQueryProblem(ON_MEETING, 'FROM task, meeting WHERE kind = standup'),
    ).toBeNull();
  });

  it('refuses a query of another type, which no note setting it off could match', () => {
    expect(noteTriggerQueryProblem(ON_MEETING, 'FROM task')).toBe(
      'A rule that runs when a meeting is created or changed takes its notes FROM meeting.',
    );
  });

  it('leaves a query that does not read for the run to refuse', () => {
    expect(noteTriggerQueryProblem(ON_MEETING, 'FROM')).toBeNull();
  });

  it('makes a rule file whose query takes another type broken, saying why', () => {
    const read = parseAutomationRule(p('.atlas/automations/Mark.md'), {
      atlas: 'automation',
      name: 'Mark',
      enabled: true,
      when: 'a meeting is created',
      which: 'FROM task',
      do: 'archive',
    });
    expect(read).toEqual({
      broken: {
        path: '.atlas/automations/Mark.md',
        name: 'Mark',
        problem: 'A rule that runs when a meeting is created takes its notes FROM meeting.',
      },
    });
  });

  it('reads a rule a note sets off', () => {
    const read = parseAutomationRule(p('.atlas/automations/Mark.md'), {
      atlas: 'automation',
      name: 'Mark',
      enabled: true,
      when: 'a meeting is created or changed',
      which: 'FROM meeting',
      do: 'archive',
    });
    expect('rule' in read && read.rule.when).toEqual(ON_MEETING);
  });

  it('refuses an age filter on a rule a note sets off: the note has just changed', () => {
    const read = parseAutomationRule(p('.atlas/automations/Mark.md'), {
      atlas: 'automation',
      name: 'Mark',
      enabled: true,
      when: 'a meeting is created',
      which: 'FROM meeting',
      olderThanDays: 30,
      do: 'archive',
    });
    expect('broken' in read && read.broken.problem).toBe(
      'A rule a note sets off acts on that note as it has just become: take olderThanDays out.',
    );
  });
});

describe('triggeringVersions', () => {
  it('hears a note of its type that arrived, as the version the feed reported', () => {
    const changes = [change('added', 'Inbox/Meetings/Standup.md', { digest: 'abc' })];
    expect(triggeringVersions(MEETING_CREATED, changes)).toEqual([
      { path: 'Inbox/Meetings/Standup.md', digest: 'abc' },
    ]);
    expect(triggeringVersions(MEETING_CHANGED, changes)).toEqual([]);
  });

  it('hears a note of its type whose bytes changed, only when it waits for a change', () => {
    const changes = [change('changed', 'Meetings/Kickoff.md')];
    expect(triggeringVersions(MEETING_CHANGED, changes).map((each) => each.path)).toEqual([
      'Meetings/Kickoff.md',
    ]);
    expect(triggeringVersions(MEETING_CREATED, changes)).toEqual([]);
  });

  it('hears neither a note of another type, nor one with none, nor a note that went', () => {
    const changes = [
      change('added', 'Tasks/A.md', { type: 'task' }),
      change('changed', 'Plain.md', { type: null }),
      change('removed', 'Meetings/Gone.md'),
    ];
    expect(triggeringVersions(ON_MEETING, changes)).toEqual([]);
  });

  it('does not take a note moved or renamed for one that arrived', () => {
    const moved = [
      change('removed', 'Inbox/Meetings/Standup.md', { digest: 'same' }),
      change('added', 'Meetings/Standup.md', { digest: 'same' }),
    ];
    expect(triggeringVersions(ON_MEETING, moved)).toEqual([]);
  });

  it('takes two copies with the same bytes, nothing gone, as two arrivals', () => {
    const copies = [
      change('added', 'Inbox/Meetings/A.md', { digest: 'same' }),
      change('added', 'Inbox/Meetings/B.md', { digest: 'same' }),
    ];
    expect(triggeringVersions(MEETING_CREATED, copies)).toHaveLength(2);
  });

  it('does not take a note put back from the Archive for one that arrived', () => {
    const restored = [
      change('removed', 'Archive/Inbox/Meetings/Standup.md', { digest: 'stamped' }),
      change('added', 'Inbox/Meetings/Standup.md', { digest: 'plain' }),
    ];
    expect(triggeringVersions(MEETING_CREATED, restored)).toEqual([]);
  });

  it('leaves a note in the Archive out: archiving it is not its arrival', () => {
    const archived = [change('added', 'Archive/Inbox/Meetings/Standup.md')];
    expect(triggeringVersions(ON_MEETING, archived)).toEqual([]);
  });
});

describe('handledVersions', () => {
  const run = (versions: Extract<LogEntry, { kind: 'run' }>['versions']): LogEntry => ({
    kind: 'run',
    at: '2026-10-08T09:00:00',
    trigger: 'note',
    done: [],
    left: [],
    capped: false,
    ...(versions !== undefined && { versions }),
  });

  it('remembers the versions a run handled and the ones it wrote, and no others', () => {
    const handled = handledVersions([
      run([
        { path: p('Inbox/Meetings/A.md'), digest: 'one', wrote: false },
        { path: p('Inbox/Meetings/A.md'), digest: 'two', wrote: true },
      ]),
      run(undefined),
      { kind: 'failed', at: '2026-10-08T09:01:00', trigger: 'note', problem: 'No.' },
    ]);
    const versions = [
      { path: p('Inbox/Meetings/A.md'), digest: 'one' },
      { path: p('Inbox/Meetings/A.md'), digest: 'two' },
      { path: p('Inbox/Meetings/A.md'), digest: 'three' },
      { path: p('Inbox/Meetings/B.md'), digest: 'one' },
    ];
    expect(unhandledVersions(versions, handled)).toEqual(versions.slice(2));
  });
});

describe('a note deleted, and what the rule remembers of it', () => {
  const STANDUP = p('Inbox/Meetings/Standup.md');
  const ran = (extra: Partial<Extract<LogEntry, { kind: 'run' }>>): LogEntry => ({
    kind: 'run',
    at: '2026-10-08T09:00:00',
    trigger: 'note',
    done: [],
    left: [],
    capped: false,
    ...extra,
  });
  const handledOnce = ran({ versions: [{ path: STANDUP, digest: 'one', wrote: false }] });

  it('forgets every version of a note once the log says it went, and remembers what came after', () => {
    const handled = handledVersions([
      handledOnce,
      ran({ went: [STANDUP] }),
      ran({ versions: [{ path: STANDUP, digest: 'two', wrote: true }] }),
    ]);
    expect(handled.has({ path: STANDUP, digest: 'one' })).toBe(false);
    expect(handled.has({ path: STANDUP, digest: 'two' })).toBe(true);
    expect(handledVersions([handledOnce]).has({ path: STANDUP, digest: 'one' })).toBe(true);
  });

  it('names the deleted notes of its type it had handled, not ones moved, archived or never handled', () => {
    const handled = handledVersions([
      ran({
        versions: [
          { path: STANDUP, digest: 'one', wrote: false },
          { path: p('Inbox/Meetings/Moved.md'), digest: 'two', wrote: false },
          { path: p('Inbox/Meetings/Filed.md'), digest: 'three', wrote: false },
          { path: p('Tasks/Done.md'), digest: 'four', wrote: false },
        ],
      }),
    ]);
    const changes = [
      change('removed', STANDUP, { digest: 'one' }),
      change('removed', 'Inbox/Meetings/Moved.md', { digest: 'two' }),
      change('added', 'Meetings/Moved.md', { digest: 'two' }),
      change('removed', 'Inbox/Meetings/Filed.md', { digest: 'three' }),
      change('added', 'Archive/Inbox/Meetings/Filed.md', { digest: 'stamped' }),
      change('removed', 'Tasks/Done.md', { type: 'task', digest: 'four' }),
      change('removed', 'Inbox/Meetings/Never.md'),
    ];
    expect(deletedHandledNotes(ON_MEETING, changes, handled)).toEqual([STANDUP]);
  });

  it('hears a note of its type that went, for what it remembers of it, and nothing of other types', () => {
    expect(noteTriggerHears(MEETING_CREATED, [change('removed', STANDUP)])).toBe(true);
    expect(noteTriggerHears(MEETING_CREATED, [change('added', STANDUP)])).toBe(true);
    expect(noteTriggerHears(MEETING_CREATED, [change('changed', STANDUP)])).toBe(false);
    expect(noteTriggerHears(MEETING_CREATED, [change('removed', STANDUP, { type: 'task' })])).toBe(
      false,
    );
  });
});

/**
 * The #214 tidy moves let-in meetings from Inbox/Meetings into
 * Meetings/<YYYY>/<MM> — still where meeting files land — and rewrites a link
 * in one when a note it links moved too. The catch-up when DFAI opens
 * (missedArrivals) must not take such a meeting for an arrival a `created`
 * rule never ran on: a `set` rule run again writes its value over whatever the
 * person changed since (found by adv-222).
 */
import { describe, expect, it } from 'vitest';
import type { NoteChange } from '../index/note-changes.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  handledVersions,
  leftHandledNotes,
  missedArrivals,
  movedHandledNotes,
  type NoteTrigger,
} from './note-trigger.ts';
import type { LogEntry } from './run-log.ts';

const MEETING_CREATED: NoteTrigger = { kind: 'note', type: 'meeting', on: ['created'] };
const OLD = createVaultPath('Inbox/Meetings/2026-09-29 Larkspur sync.md');
const NEW = createVaultPath('Meetings/2026/09/2026-09-29 Larkspur sync.md');

const ranOn = (digest: string): LogEntry => ({
  kind: 'run',
  at: '2026-09-29T10:00:00',
  trigger: 'note',
  done: [],
  left: [],
  capped: false,
  versions: [{ path: OLD, digest, wrote: false }],
});

const movedMeeting = (digest: string, modified: number) => ({
  path: NEW,
  digest,
  type: 'meeting',
  importOutcome: 'imported',
  importDeclared: true as const,
  modified,
});

describe('a meeting the tidy moved', () => {
  it('is not an arrival the rule missed, when the rule never heard of the move', () => {
    const missed = missedArrivals({
      trigger: MEETING_CREATED,
      // Moved by the tidy, its [[Acme]] rewritten to [[Companies/Acme]]: new bytes, written now.
      notes: [movedMeeting('with [[Companies/Acme]]', 9_000)],
      handled: handledVersions([ranOn('with [[Acme]]')]),
      since: 1_000,
    });
    expect(missed).toEqual([]);
  });

  it('is not an arrival the rule missed once its log has the move (same bytes)', () => {
    // The feed's news of the move, as the rule hears it: the old path gone, the new one added.
    const changes: NoteChange[] = [
      { kind: 'removed', path: OLD, type: 'meeting', digest: 'same', importOutcome: 'imported' },
      {
        kind: 'added',
        path: NEW,
        type: 'meeting',
        digest: 'same',
        importOutcome: 'imported',
        importDeclared: true,
      },
    ];
    const before = handledVersions([ranOn('same')]);
    const heardTheMove: LogEntry = {
      kind: 'run',
      at: '2026-10-14T10:00:00',
      trigger: 'note',
      done: [],
      left: [],
      capped: false,
      went: leftHandledNotes(changes, before),
      moved: movedHandledNotes(changes, before),
    };
    expect(heardTheMove).toMatchObject({
      went: [OLD],
      moved: [{ from: OLD, path: NEW, digest: 'same' }],
    });

    const missed = missedArrivals({
      trigger: MEETING_CREATED,
      // A rename keeps the file's modification time: the import's stamp, after the rule was saved.
      notes: [movedMeeting('same', 2_000)],
      handled: handledVersions([ranOn('same'), heardTheMove]),
      since: 1_000,
    });
    expect(missed).toEqual([]);
  });

  it('is still an arrival when the rule handled nothing of that name', () => {
    const elsewhere: LogEntry = {
      kind: 'run',
      at: '2026-09-28T10:00:00',
      trigger: 'note',
      done: [],
      left: [],
      capped: false,
      versions: [
        { path: createVaultPath('Inbox/Meetings/2026-09-28 Other.md'), digest: 'x', wrote: false },
      ],
    };
    const missed = missedArrivals({
      trigger: MEETING_CREATED,
      notes: [movedMeeting('fresh', 9_000)],
      handled: handledVersions([elsewhere]),
      since: 1_000,
    });
    expect(missed).toEqual([{ path: NEW, digest: 'fresh' }]);
  });

  it('is still an arrival when the note it shares a name with is still where it was', () => {
    const missed = missedArrivals({
      trigger: MEETING_CREATED,
      notes: [{ ...movedMeeting('old', 500), path: OLD }, movedMeeting('a second copy', 9_000)],
      handled: handledVersions([ranOn('old')]),
      since: 1_000,
    });
    expect(missed).toEqual([{ path: NEW, digest: 'a second copy' }]);
  });
});

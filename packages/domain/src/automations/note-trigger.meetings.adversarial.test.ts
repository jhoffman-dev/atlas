import { describe, expect, it } from 'vitest';
import type { NoteChange } from '../index/note-changes.ts';
import type { ImportOutcome } from '../meetings/meeting-arrival.ts';
import { triggeringVersions, type NoteTrigger } from './note-trigger.ts';

/**
 * #92 attack: "a rule runs once a meeting is in" — its arrival is the version
 * the import let in. Each case below is one sequence of syncs, as the feed
 * would report them, that has a rule hear `created` for a meeting that is
 * not new, or miss one that is.
 */
const MEETING_CREATED: NoteTrigger = { kind: 'note', type: 'meeting', on: ['created'] };

const note = (
  kind: NoteChange['kind'],
  path: string,
  digest: string,
  extra: {
    importOutcome?: ImportOutcome;
    before?: string;
    beforeImportOutcome?: ImportOutcome;
    beforeArrivalHeard?: true;
  } = {},
): NoteChange => ({ kind, path, type: 'meeting', digest, ...extra });

/** Every `created` the syncs set off, in order. */
const createdAcross = (syncs: readonly (readonly NoteChange[])[]) =>
  syncs.flatMap((changes) => triggeringVersions(MEETING_CREATED, changes));

describe('note triggers where meeting files land: what is not a meeting arriving (#92 attack)', () => {
  it('does not take a sync conflict copy of a let-in meeting for a new meeting', () => {
    // Both Macs edited the meeting; the merge keeps this Mac's and copies the
    // other's beside it. The copy carries `imported`, so the import never
    // judges it ("the person's to settle, never a copy") — it never let it in.
    const copy = 'Inbox/Meetings/2026-10-06 Standup (conflict from Work Mac).md';
    const changes = [note('added', copy, 'their-edit', { importOutcome: 'imported' })];

    expect(triggeringVersions(MEETING_CREATED, changes)).toEqual([]);
  });

  it('does not take an edit of a let-in meeting for its arrival when a note of the same name is made elsewhere', () => {
    // One sync (or one relaunch): the person edits the meeting where it landed,
    // and a new meeting of the same name is written under Projects. The edited
    // meeting never left its path; the Projects one is the only new note.
    const landed = 'Inbox/Meetings/Weekly sync.md';
    const elsewhere = 'Projects/Weekly sync.md';
    const changes = [
      note('changed', landed, 'edited', {
        importOutcome: 'imported',
        before: 'stamped',
        beforeImportOutcome: 'imported',
      }),
      note('added', elsewhere, 'new-meeting'),
    ];

    expect(triggeringVersions(MEETING_CREATED, changes)).toEqual([
      { path: elsewhere, digest: 'new-meeting' },
    ]);
  });

  it('sets a meeting off as created once, though it is moved where meetings land and then let in', () => {
    const filed = 'Meetings/Retro.md';
    const landed = 'Inbox/Meetings/Retro.md';
    const syncs = [
      // Written by hand outside the meeting inbox: arriving is being written.
      [note('added', filed, 'plain')],
      // Moved, unchanged, to where meeting files land: not an arrival.
      [note('removed', filed, 'plain'), note('added', landed, 'plain')],
      // The import stamps it. The feed remembers it was moved in, having been heard.
      [
        note('changed', landed, 'stamped', {
          importOutcome: 'imported',
          before: 'plain',
          beforeArrivalHeard: true,
        }),
      ],
    ];

    expect(createdAcross(syncs)).toHaveLength(1);
  });

  it('does not take a let-in meeting re-stamped after its stamp was lost for a new arrival', () => {
    // The stamp line is dropped (a hand edit, or the file overwritten by an
    // outside sync), and the import, finding no stamp, lets the same meeting
    // in again. It was created long ago; nothing new arrived.
    const landed = 'Inbox/Meetings/2026-10-06 Standup.md';
    const syncs = [
      [
        note('changed', landed, 'unstamped', {
          before: 'stamped',
          beforeImportOutcome: 'imported',
          beforeArrivalHeard: true,
        }),
      ],
      [
        note('changed', landed, 'restamped', {
          importOutcome: 'imported',
          before: 'unstamped',
          beforeArrivalHeard: true,
        }),
      ],
    ];

    expect(createdAcross(syncs)).toEqual([]);
  });

  it('takes a let-in meeting renamed while a new file lands at its old name as renamed, not arrived', () => {
    // A recurring meeting lands under the same name each week. While the app
    // is closed, last week's is renamed in Finder and this week's lands where
    // it was. The new file is not let in yet (no stamp); the renamed one has
    // the very bytes, stamp and all, the old path held: it moved.
    const landed = 'Inbox/Meetings/Weekly sync.md';
    const renamed = 'Inbox/Meetings/Weekly sync 2026-10-05.md';
    const changes = [
      note('changed', landed, 'this-week', {
        before: 'last-week',
        beforeImportOutcome: 'imported',
      }),
      note('added', renamed, 'last-week', { importOutcome: 'imported' }),
    ];

    expect(triggeringVersions(MEETING_CREATED, changes)).toEqual([]);
  });
});

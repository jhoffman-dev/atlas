import { describe, expect, it } from 'vitest';
import { filedUnderStamp, processDestination } from '../inbox/inbox.ts';
import { arrivedPaths, type NoteChange } from '../index/note-changes.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { triggeringVersions, type NoteTrigger } from './note-trigger.ts';

/**
 * #62 (note triggers) x #65 (Inbox Process). ADR-0028: "A note moved,
 * renamed, archived or put back from the Archive is neither created nor
 * changed", and `unpairedChanges` says "filing ... a note is not its
 * arrival". Process is a move *and* a stamp (`project: [[…]]`) done before
 * the one refresh `use-inbox` asks for, so the feed sees the Inbox path
 * removed and the project path added with different bytes — the same shape
 * the Archive's pairing exists for, with no pairing of its own.
 */
const p = createVaultPath;
const MEETING_CREATED: NoteTrigger = { kind: 'note', type: 'meeting', on: ['created'] };

describe('Processing a meeting out of the Inbox, as the change feed hears it', () => {
  const from = p('Inbox/Meetings/2026-10-01 Larkspur kickoff.md');
  const project = p('Projects/Larkspur Payroll.md');
  const to = processDestination({ path: from, project, taken: new Set() });
  // What Process leaves: the same note, moved, with `project:` written into it.
  const stamp = filedUnderStamp({ project, notePaths: [from, project] });
  const changes: NoteChange[] = [
    { kind: 'removed', path: from, type: 'meeting', digest: 'before-filing' },
    { kind: 'added', path: to, type: 'meeting', digest: `after-filing:${stamp['project']}` },
  ];

  it('is not the arrival of a new note', () => {
    expect(to).toBe('Projects/Larkspur Payroll/2026-10-01 Larkspur kickoff.md');
    expect([...arrivedPaths(changes)]).toEqual([]);
  });

  it('does not set off "a meeting is created" a second time', () => {
    expect(triggeringVersions(MEETING_CREATED, changes)).toEqual([]);
  });
});

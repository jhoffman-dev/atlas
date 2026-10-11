import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import type { MeetingImporter } from '../meetings/meeting-importer.ts';
import type { MeetingImportOutcome } from '../meetings/import-arrived-meetings.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { jsonLinesMarkdown, jsonLinesNote, proposalVault } from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { createMeetingLinker, linkImportedMeetings } from './link-imported-meetings.ts';

const VAULT = '/Users/someone/Vault';
const p = (path: string) => createVaultPath(path);

function importerSaying(outcome: MeetingImportOutcome | null): MeetingImporter {
  return { hear: async () => outcome, catchUp: async () => outcome };
}

describe('linkImportedMeetings', () => {
  it('links each meeting the import let in — arrived, or fixed — and nothing else', async () => {
    const outcome: MeetingImportOutcome = {
      wrote: true,
      happenings: [
        { kind: 'arrived', path: p('Inbox/Meetings/A.md') },
        { kind: 'fixed', path: p('Inbox/Meetings/B.md') },
        { kind: 'invalid', path: p('Inbox/Meetings/C.md'), problem: 'x', unmarked: null },
        { kind: 'conflict', path: p('Inbox/Meetings/D.md') },
      ],
    };
    const linker = vi.fn(async () => []);
    const importer = linkImportedMeetings({ importer: importerSaying(outcome), linker });
    expect(await importer.hear({ vault: VAULT, changes: [] })).toBe(outcome);
    expect(await importer.catchUp(VAULT)).toBe(outcome);
    expect(linker.mock.calls).toEqual([
      [VAULT, ['Inbox/Meetings/A.md', 'Inbox/Meetings/B.md']],
      [VAULT, ['Inbox/Meetings/A.md', 'Inbox/Meetings/B.md']],
    ]);
  });

  it('links nothing when the import let nothing in, or did not run', async () => {
    const linker = vi.fn(async () => []);
    await linkImportedMeetings({ importer: importerSaying(null), linker }).catchUp(VAULT);
    await linkImportedMeetings({
      importer: importerSaying({ wrote: false, happenings: [] }),
      linker,
    }).catchUp(VAULT);
    expect(linker).not.toHaveBeenCalled();
  });
});

describe('createMeetingLinker', () => {
  const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';
  const files = {
    [MEETING]: jsonLinesNote({ type: 'meeting', attendees: [{ name: 'Mara Quill' }] }),
    'People/Mara Quill.md': jsonLinesNote({ type: 'person' }),
    'Tasks/Not a meeting.md': jsonLinesNote({ type: 'task' }),
  };

  function linkerOver(openVault: () => string | null) {
    const setup = proposalVault(files);
    const query = atlasQueryIndex({ files, markdown: jsonLinesMarkdown() });
    const activity = recordingActivity();
    const onWritten = vi.fn();
    const linker = createMeetingLinker({
      ports: () => ({ ...setup.ports, index: { ...setup.ports.index, query } }),
      clock: { today: () => '2026-10-06' },
      activity,
      openVault,
      selfName: () => null,
      onWritten,
    });
    return { setup, activity, onWritten, linker };
  }

  it('links each meeting, says so in Activity, and says when one could not be', async () => {
    const { setup, activity, onWritten, linker } = linkerOver(() => VAULT);
    const runs = await linker(VAULT, [p(MEETING), p('Tasks/Not a meeting.md')]);
    expect(runs.map(({ meeting }) => meeting)).toEqual([MEETING]);
    expect(setup.propertiesOf(MEETING)?.['people']).toEqual(['[[Mara Quill]]']);
    expect(activity.reports.map(({ level, message }) => [level, message])).toEqual([
      ['info', '2026-10-06 Standup: linked Mara Quill.'],
      ['error', 'Could not link the meeting: Tasks/Not a meeting.md is not a meeting.'],
    ]);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it('links nothing once another vault is open', async () => {
    const { setup, activity, onWritten, linker } = linkerOver(() => '/Users/someone/Other');
    expect(await linker(VAULT, [p(MEETING)])).toEqual([]);
    expect(setup.propertiesOf(MEETING)?.['people']).toBeUndefined();
    expect(activity.reports).toEqual([]);
    expect(onWritten).not.toHaveBeenCalled();
  });

  it('does not ask for a re-read when it wrote nothing', async () => {
    const { onWritten, linker } = linkerOver(() => VAULT);
    await linker(VAULT, [p(MEETING)]);
    await linker(VAULT, [p(MEETING)]);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });
});

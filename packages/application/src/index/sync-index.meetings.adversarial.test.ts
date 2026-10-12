import { describe, expect, it } from 'vitest';
import { createVaultPath, digestOf, triggeringVersions } from '@atlas/domain';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { syncIndex } from './sync-index.ts';

/**
 * #92 attack: a rebuild must not re-fire `created` for every meeting already
 * let in. The baseline a rebuild is measured from is now two questions — the
 * manifest, and (new in #92) the import stamps from `props` — and a rebuild
 * that cannot get an answer goes ahead from nothing. So an index whose
 * manifest answers but whose `props` cannot, which before #92 rebuilt
 * quietly, now reports every note as added: every let-in meeting arrives
 * again.
 */
const STANDUP = 'Inbox/Meetings/2026-10-06 Standup.md';
const TEXT = '---\ntype: meeting\natlas_import_outcome: imported\n---\nAgenda.\n';

function indexWithUnreadableStamps() {
  let cleared = false;
  return fakeIndexPort({
    clear: async () => {
      cleared = true;
    },
    manifest: async () =>
      cleared
        ? []
        : [
            {
              path: STANDUP,
              modified: 1,
              size: TEXT.length,
              digest: digestOf(TEXT),
              type: 'meeting',
            },
          ],
    query: async (_sql, parameters) => {
      if (parameters.includes('atlas_import_outcome'))
        throw new Error('no such column: value_text');
      return { columns: [], rows: [], truncated: false };
    },
  });
}

describe('rebuilding the index, where meetings have landed (#92 attack)', () => {
  it('reports no meeting as arrived when the manifest says what the index held', async () => {
    const fs = fakeVaultFs({
      listNotes: async () => [
        { name: 'Standup.md', path: createVaultPath(STANDUP), modified: 1, size: TEXT.length },
      ],
      readNotes: async () => [{ path: STANDUP, text: TEXT, modified: 1, size: TEXT.length }],
    });

    const { changes } = await syncIndex({
      fs,
      index: indexWithUnreadableStamps(),
      markdown: fakeMarkdown(),
      fromScratch: true,
      activity: recordingActivity(),
    });

    expect(triggeringVersions({ kind: 'note', type: 'meeting', on: ['created'] }, changes)).toEqual(
      [],
    );
  });

  it('does not fail an ordinary sync because the stamps cannot be asked for, and hears no edit as an arrival', async () => {
    const edited = `${TEXT}More.\n`;
    const fs = fakeVaultFs({
      listNotes: async () => [
        { name: 'Standup.md', path: createVaultPath(STANDUP), modified: 2, size: edited.length },
      ],
      readNotes: async () => [{ path: STANDUP, text: edited, modified: 2, size: edited.length }],
    });

    const { changes } = await syncIndex({
      fs,
      index: indexWithUnreadableStamps(),
      markdown: fakeMarkdown(),
      fromScratch: false,
      activity: recordingActivity(),
    });

    expect(changes).toHaveLength(1);
    expect(triggeringVersions({ kind: 'note', type: 'meeting', on: ['created'] }, changes)).toEqual(
      [],
    );
  });
});

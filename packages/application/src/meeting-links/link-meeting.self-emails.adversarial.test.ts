import { describe, expect, it } from 'vitest';
import {
  jsonLinesMarkdown,
  jsonLinesNote,
  proposalVault,
  vaultPath,
} from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { linkMeeting, type MeetingLinkPorts } from './link-meeting.ts';

/**
 * Adversarial (#173): a vault that sets neither `selfEmails` nor its alias
 * must link a meeting as it did before the setting existed.
 */

const TODAY = '2026-10-06';
const MEETING = 'Inbox/Meetings/2026-10-06 Ledger sync.md';
const OWNER_ADDRESS = 'mara.quill@example.com';

const FILES = {
  // The owner's own note, and a second note at the same address (an import's duplicate).
  'People/Mara Quill.md': jsonLinesNote({ type: 'person', email: OWNER_ADDRESS }),
  'People/M Quill.md': jsonLinesNote({ type: 'person', email: OWNER_ADDRESS }),
  '.atlas/types/meeting.md': jsonLinesNote({
    name: 'meeting',
    properties: { people: { kind: 'relation', target: 'person', many: true } },
  }),
  // No transcript speakers: nothing but the owner's address says who `mq` is.
  [MEETING]: jsonLinesNote(
    {
      type: 'meeting',
      atlas_import: 'meeting/v1',
      atlas_import_outcome: 'imported',
      title: 'Ledger sync',
      date: TODAY,
      start: '09:30',
      provider: 'gemini',
      external_id: 'gemini-adv173',
      attendees: [{ name: 'mq', email: OWNER_ADDRESS }],
    },
    '\n## Summary\n\nLedger sync.\n',
  ),
};

function vault(): { paths: () => string[]; ports: MeetingLinkPorts } {
  const setup = proposalVault(FILES);
  const query = atlasQueryIndex({ files: FILES, markdown: jsonLinesMarkdown() });
  return {
    paths: () => setup.paths(),
    ports: { ...setup.ports, index: { ...setup.ports.index, query } },
  };
}

describe('linking with neither selfEmails nor granola_self_emails set', () => {
  it('asks nothing about the owner when two Person notes hold the owner’s note’s address', async () => {
    const { paths, ports } = vault();
    await linkMeeting({ ports, path: vaultPath(MEETING), today: TODAY, selfName: 'Mara Quill' });
    // Before #173 the owner's own note's address was the owner's, and the owner was never asked about.
    expect(paths().filter((path) => path.startsWith('Inbox/Proposals/'))).toEqual([]);
  });
});

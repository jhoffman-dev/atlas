/**
 * Adversarial pass over a meeting's arrival as the stack built it (#92,
 * P28-06, P29-04): linked, then corrected and stamped. What the import does
 * when the index is behind the folder, when a Term and a person's alias spell
 * a speaker the same way, and when the Inbox's proposals cannot be written.
 * Over the fake vault whose index answers with real SQL, as
 * `meeting-arrival-sequence.test.ts` is.
 *
 * Every test here fails on p29-03: each names the invariant it breaks.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  importOutcomeOf,
  noteChangesBetween,
  parseObjectType,
  type NoteVersion,
} from '@atlas/domain';
import { heldEntries } from '../index/refresh-index.ts';
import { createMeetingLinker, linkBeforeLetIn } from '../meeting-links/link-imported-meetings.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { MEETING_HEADER } from '../testing/meeting-files.ts';
import { createMeetingImporter } from './meeting-importer.ts';

const TODAY = '2026-10-08';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';
/** The same meeting under the name its second delivery takes (ADR-0027, "the collision path"). */
const SECOND_COPY = 'Inbox/Meetings/2026-10-06 Standup (gemini 1a2b3c4d).md';
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { status: 'text' } }),
];

/**
 * Mara Quill is in People. Tobias Fenn goes by "Toby", an alias only his
 * Person note holds; "Tobi" is a product, and transcripts mishear it as "Toby".
 */
const DIRECTORY = {
  'People/Mara Quill.md': jsonNote({ type: 'person' }, ''),
  'People/Tobias Fenn.md': jsonNote({ type: 'person', aliases: ['Toby'] }, ''),
  'Terms/Tobi.md': jsonNote({ type: 'term', kind: 'product', variants: ['Toby'] }, ''),
};

const BODY = [
  '',
  '## Summary',
  '',
  'Go-live moves a week. ^s1',
  '',
  '## Transcript',
  '',
  '**Toby** [~00:00:00] Morning. The file is late. ^t0001',
  '',
].join('\n');

const ARRIVING = jsonNote(
  {
    ...MEETING_HEADER,
    attendees: [{ name: 'Mara Quill' }, { name: 'Ines Abara', email: 'ines.abara@example.net' }],
  },
  BODY,
);

async function setUp({ openVault = () => VAULT }: { openVault?: () => string | null } = {}) {
  const vault = automationVault({ notes: { ...DIRECTORY }, today: TODAY, types: TYPES });
  // The fake vault knows only the folders its first notes sat in: where meetings land is made as a pull makes it.
  for (const folder of ['Inbox', 'Inbox/Meetings']) {
    await vault.ports.fs.createFolder({ path: createVaultPath(folder) });
  }
  const activity = recordingActivity();
  const wiring = {
    ports: () => vault.ports,
    clock: CLOCK,
    activity,
    openVault,
    onWritten: () => undefined,
  };
  const linker = createMeetingLinker({ ...wiring, selfName: () => null });
  const importer = createMeetingImporter({
    ...wiring,
    active: () => true,
    // As the app wires it: the linker is handed what the import's run has read.
    beforeLetIn: linkBeforeLetIn(linker),
  });
  const land = (path: string) =>
    vault.ports.fs.createNote({ path: createVaultPath(path), contents: ARRIVING });
  /** The meeting lands and the import hears the sync that found it. */
  const arrive = async () => {
    const before = new Map<string, NoteVersion>(await heldEntries(vault.ports.index));
    await land(MEETING);
    const changes = noteChangesBetween(before, await heldEntries(vault.ports.index));
    await importer.hear({ vault: VAULT, changes });
  };
  const messages = () => activity.reports.map((report) => report.message);
  return { vault, importer, land, arrive, messages };
}

describe('a meeting arriving while the index is behind the folder', () => {
  it('lets one meeting in once when two files of it wait and the index has read neither', async () => {
    const { vault, importer, land } = await setUp();
    // The index as it was before the pull: it answers, and knows nothing of either file.
    const beforeThePull = automationVault({ notes: { ...DIRECTORY }, today: TODAY, types: TYPES });
    await land(MEETING);
    await land(SECOND_COPY);
    vault.ports.index.query = beforeThePull.ports.index.query;

    // Catching up lists the folder itself (ADR-0027: "the change feed only says where to look").
    await importer.catchUp(VAULT);

    const letIn = [...vault.files.keys()].filter(
      (path) => importOutcomeOf(vault.properties(path)) === 'imported',
    );
    expect(letIn).toEqual([MEETING]);
  });
});

describe('a speaker a person’s alias names and a Term’s misheard spelling also spells', () => {
  it('links the person the alias names, as it would have before the words were corrected', async () => {
    const { vault, arrive } = await setUp();

    await arrive();

    // Sanity: the meeting was let in, and the attendee matched by name is linked.
    expect(vault.properties(MEETING)).toMatchObject({ atlas_import_outcome: 'imported' });
    expect(vault.properties(MEETING)['people']).toContain('[[Mara Quill]]');
    // ADR-0027: "Aliases link, Terms correct" — the alias still names Tobias.
    expect(vault.properties(MEETING)['people']).toContain('[[Tobias Fenn]]');
  });
});

describe('a meeting whose proposals cannot be written', () => {
  it('still says in Activity who it linked, since the links are in the meeting', async () => {
    const { vault, arrive, messages } = await setUp();
    const list = vault.ports.fs.listDirectory;
    vault.ports.fs.listDirectory = async (folder) => {
      if (folder === 'Inbox/Proposals') throw new Error('permission denied');
      return list(folder);
    };

    await arrive();

    // The link write happened before the proposals were tried.
    expect(vault.properties(MEETING)['people']).toContain('[[Mara Quill]]');
    expect(messages().some((message) => message.includes('linked Mara Quill'))).toBe(true);
    expect(messages()).not.toContain('Could not link the meeting: permission denied');
  });
});

describe('a speaker label that is exactly a person’s alias', () => {
  it('is not rewritten by a Term that lists the same spelling as misheard', async () => {
    const { vault, arrive } = await setUp();

    await arrive();

    expect(vault.properties(MEETING)).toMatchObject({ atlas_import_outcome: 'imported' });
    expect(vault.files.get(MEETING)).toContain('**Toby** [~00:00:00]');
  });
});

describe('a meeting whose links were written and whose stamp write then failed', () => {
  it('is stamped the next time the import looks, with no one linked or proposed twice', async () => {
    const { vault, importer, arrive, messages } = await setUp();
    const write = vault.ports.fs.writeTextFile;
    let writes = 0;
    vault.ports.fs.writeTextFile = async (args) => {
      // The first write to the meeting is its links; the second, its stamp, is refused once.
      if (args.path === MEETING && (writes += 1) === 2) throw new Error('disk full');
      return write(args);
    };

    await arrive();

    expect(vault.properties(MEETING)['people']).toEqual(['[[Mara Quill]]', '[[Tobias Fenn]]']);
    expect(importOutcomeOf(vault.properties(MEETING))).toBeNull();
    const proposed = () =>
      [...vault.files.keys()].filter((at) => at.startsWith('Inbox/Proposals/'));
    const proposedFirst = proposed();
    expect(proposedFirst).toHaveLength(1);
    expect(messages().some((message) => message.includes('disk full'))).toBe(true);

    await importer.catchUp(VAULT);

    expect(importOutcomeOf(vault.properties(MEETING))).toBe('imported');
    expect(vault.properties(MEETING)['people']).toEqual(['[[Mara Quill]]', '[[Tobias Fenn]]']);
    expect(proposed()).toEqual(proposedFirst);
  });
});

describe('another vault opened while a meeting was being linked', () => {
  it('leaves the meeting unstamped and says so in Activity', async () => {
    let open: string | null = VAULT;
    const { vault, arrive, messages } = await setUp({ openVault: () => open });
    const read = vault.ports.fs.readTextFile;
    let reads = 0;
    vault.ports.fs.readTextFile = async (path) => {
      // The import reads the meeting to judge it; the vault changes before it is linked or let in.
      if (path === MEETING && (reads += 1) === 2) open = '/vaults/other';
      return read(path);
    };

    await arrive();

    expect(reads).toBeGreaterThanOrEqual(2);
    expect(importOutcomeOf(vault.properties(MEETING))).toBeNull();
    expect(messages().some((message) => /another vault was opened/i.test(message))).toBe(true);
  });
});

describe('the vocabulary a meeting’s speakers are read by', () => {
  it('is the import run’s own: read once for a meeting, not again to link it', async () => {
    const { vault, arrive } = await setUp();
    const query = vault.ports.index.query;
    let vocabularyReads = 0;
    vault.ports.index.query = async (sql, parameters) => {
      if (sql.includes('terms:notes')) vocabularyReads += 1;
      return query(sql, parameters);
    };

    await arrive();

    expect(vault.properties(MEETING)).toMatchObject({ atlas_import_outcome: 'imported' });
    expect(vocabularyReads).toBe(1);
  });
});

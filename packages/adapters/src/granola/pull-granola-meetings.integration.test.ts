/**
 * The Granola pull (P28-11) over a fake Granola and a vault held in memory,
 * read and written through the real YAML reader, so every file the pull
 * writes is the file `receiveMeeting` writes and the import reads. All
 * names are made up.
 */
import { describe, expect, it } from 'vitest';
import {
  apiFixture,
  createGranolaPuller,
  fakeGranola,
  granolaNote,
  GranolaError,
  granolaTurn,
  type GranolaPullRecord,
  type GranolaPullRecords,
} from '@atlas/application';
import { atlasQueryIndex } from '@atlas/application/testing/sqlite';
import {
  mapGranolaNote,
  splitFrontmatter,
  TRANSCRIPT_LIMIT,
  type GranolaFailure,
  type GranolaNote,
} from '@atlas/domain';
import { remarkMarkdown } from '../markdown/markdown-port.ts';

/** The vault `apiFixture` opens, and another to switch to. */
const VAULT = { absolutePath: '/Users/j/Vault', name: 'Vault' };
const OTHER_VAULT = { absolutePath: '/Users/j/Other', name: 'Other' };

const START = Date.UTC(2026, 9, 13, 18);
const HOUR = 60 * 60_000;

const SETTINGS = [
  '---',
  'profileName: Mara Quill',
  'granola_time_zone: America/New_York',
  'meeting_group_addresses:',
  '  - platform-team@example.com',
  '---',
  '',
  '# Settings',
  '',
].join('\n');

const MARA = ['---', 'type: person', 'email: mara.quill@example.com', '---', '', 'Mara.', ''].join(
  '\n',
);

/** What the vault's settings tell the mapper, as n8n's OPTIONS would carry them. */
const OPTIONS = {
  timeZone: 'America/New_York',
  selfEmails: ['mara.quill@example.com'],
  groupAddresses: ['platform-team@example.com'],
};

const NEW_1 = granolaNote('not_aaaaaaaaaaaaa1', {
  title: 'Larkspur Payroll renewal',
  updatedAt: '2026-10-13T15:00:00Z',
});
const NEW_2 = granolaNote('not_aaaaaaaaaaaaa2', {
  title: 'Tobias one on one',
  updatedAt: '2026-10-13T16:00:00Z',
  attendees: [{ name: null, email: 'platform-team@example.com' }],
});
const HELD = granolaNote('not_aaaaaaaaaaaaa3', {
  title: 'Imported already',
  updatedAt: '2026-10-13T17:00:00Z',
});
/** A Granola meeting the Notion import brought in, unsettled yet, under the same id. */
const NOTION_ERA = granolaNote('not_aaaaaaaaaaaaa4', {
  title: 'From the Notion export',
  updatedAt: '2026-10-01T09:00:00Z',
});

const imported = (text: string) =>
  text.replace(
    'atlas_import: meeting/v1\n',
    'atlas_import: meeting/v1\natlas_import_outcome: imported\n',
  );

const VAULT_FILES: Record<string, string> = {
  '.atlas/settings.md': SETTINGS,
  'People/Mara Quill.md': MARA,
  'Projects/Larkspur/2026-10-06 Imported already.md': imported(
    mapGranolaNote(HELD, OPTIONS).content,
  ),
  'Inbox/Meetings/2026-10-06 From the Notion export.md': mapGranolaNote(NOTION_ERA, OPTIONS)
    .content,
};

function memoryRecords(start: Partial<GranolaPullRecord> = {}) {
  let record: GranolaPullRecord = { watermark: null, lastPullAt: null, ...start };
  const records: GranolaPullRecords & { readonly current: () => GranolaPullRecord } = {
    read: () => record,
    write: (_vault, next) => {
      record = next;
    },
    current: () => record,
  };
  return records;
}

/** A vault, Granola holding `notes`, and a puller over both, with a clock the waits move on. */
function pullFixture({
  notes = [NEW_1, NEW_2, HELD, NOTION_ERA],
  files = VAULT_FILES,
  records = memoryRecords(),
  synced = true,
}: {
  notes?: readonly GranolaNote[];
  files?: Record<string, string>;
  records?: ReturnType<typeof memoryRecords>;
  synced?: boolean;
} = {}) {
  const api = apiFixture({
    files,
    markdown: remarkMarkdown,
    index: { query: atlasQueryIndex({ files, markdown: remarkMarkdown }) },
  });
  const granola = fakeGranola({ notes });
  const clock = { now: START };
  const waits: number[] = [];
  const puller = createGranolaPuller({
    ports: () => ({
      fs: api.fs,
      markdown: remarkMarkdown,
      index: api.deps.index,
      granola: granola.port,
      records,
    }),
    clock: { now: () => clock.now },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock.now += milliseconds;
    },
    activity: api.activity,
    openVault: () => api.open?.absolutePath ?? null,
    syncedThisSession: () => synced,
  });
  const pull = (mode: 'startup' | 'periodic' | 'sync-now' = 'startup') =>
    puller.pull({ vault: VAULT.absolutePath, mode });
  const meetingFiles = () =>
    [...api.files.keys()].filter((path) => path.startsWith('Inbox/Meetings/')).sort();
  const messages = () => api.activity.reports.map((report) => report.message);
  return { api, granola, clock, waits, records, puller, pull, meetingFiles, messages };
}

const refused = (status: number): GranolaFailure => ({
  kind: 'api_refused',
  status,
  message: `Granola answered ${status}`,
});

const frontmatterOf = (text: string | undefined) =>
  remarkMarkdown.frontmatterProperties(splitFrontmatter(text ?? '').frontmatter);

describe('pulling Granola into a vault', () => {
  it('writes the notes the vault lacks, counts the ones it holds, and moves the watermark on', async () => {
    const { pull, granola, meetingFiles, records, messages } = pullFixture();

    const report = await pull();

    expect(report).toMatchObject({
      ended: 'pulled',
      held: 2,
      refused: [],
      skipped: [],
      failed: [],
      keyRefused: false,
      watermark: '2026-10-13T17:00:00.000Z',
    });
    expect(report.written).toEqual([
      'Inbox/Meetings/2026-10-06 Larkspur Payroll renewal.md',
      'Inbox/Meetings/2026-10-06 Tobias one on one.md',
    ]);
    expect(meetingFiles()).toEqual([
      'Inbox/Meetings/2026-10-06 From the Notion export.md',
      'Inbox/Meetings/2026-10-06 Larkspur Payroll renewal.md',
      'Inbox/Meetings/2026-10-06 Tobias one on one.md',
    ]);
    expect(records.current()).toEqual({ watermark: '2026-10-13T17:00:00.000Z', lastPullAt: START });
    expect(messages()).toEqual(['Granola: 2 new, 2 already in Atlas.']);
    // Held by provider and id, so never fetched.
    expect(granola.count('note', HELD.id)).toBe(0);
    expect(granola.count('note', NOTION_ERA.id)).toBe(0);
    expect(granola.count('note')).toBe(2);
  });

  it('writes the bytes n8n writes for the note, with the vault’s zone, groups and the person’s own address', async () => {
    const { pull, api } = pullFixture();
    await pull();

    const written = api.files.get('Inbox/Meetings/2026-10-06 Tobias one on one.md')?.text;
    expect(written).toBe(mapGranolaNote(NEW_2, OPTIONS).content);
    expect(frontmatterOf(written)).toMatchObject({
      start: '13:00',
      provider: 'granola',
      external_id: NEW_2.id,
      source_url: `https://notes.granola.ai/d/${NEW_2.id}`,
      attendees: [{ name: 'platform-team', email: 'platform-team@example.com', group: true }],
    });
    expect(written).toContain('**You** [13:00:00] Morning, Tobias.');
  });

  it('lists every note on a first pull and on Sync now, and from a day before the watermark otherwise', async () => {
    const first = pullFixture();
    await first.pull('startup');
    expect(first.granola.calls[0]).toEqual({ call: 'list', updatedAfter: null, cursor: null });

    const later = pullFixture({
      records: memoryRecords({ watermark: '2026-10-13T12:00:00.000Z' }),
    });
    await later.pull('periodic');
    expect(later.granola.calls[0]).toMatchObject({ updatedAfter: '2026-10-12T12:00:00.000Z' });
    await later.pull('sync-now');
    expect(later.granola.calls.filter((call) => call.call === 'list').at(-1)).toMatchObject({
      updatedAfter: null,
    });
  });

  it('waits out two 429s and writes the note', async () => {
    const { pull, granola, waits, meetingFiles } = pullFixture({ notes: [NEW_1] });
    granola.fail(`note:${NEW_1.id}`, refused(429), refused(429));

    const report = await pull();

    expect(report.ended).toBe('pulled');
    expect(report.written).toHaveLength(1);
    expect(meetingFiles()).toContain('Inbox/Meetings/2026-10-06 Larkspur Payroll renewal.md');
    expect(granola.count('note', NEW_1.id)).toBe(3);
    expect(waits.filter((wait) => wait >= 1_000)).toEqual([1_000, 2_000]);
  });

  it('leaves a note Granola keeps answering 429 for the next pull, holding the watermark at it', async () => {
    const records = memoryRecords();
    const { pull, granola, api, meetingFiles } = pullFixture({ notes: [NEW_1, NEW_2], records });
    granola.fail(`note:${NEW_1.id}`, ...Array.from({ length: 6 }, () => refused(429)));

    const report = await pull();

    expect(granola.count('note', NEW_1.id)).toBe(6);
    expect(report.failed).toEqual([
      {
        id: NEW_1.id,
        title: 'Larkspur Payroll renewal',
        url: null,
        problem: 'Granola asked Atlas to slow down.',
      },
    ]);
    expect(report.written).toEqual(['Inbox/Meetings/2026-10-06 Tobias one on one.md']);
    // Not past the note that failed, though a newer one was written.
    expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
    expect(api.activity.reports.map(({ level }) => level)).toEqual(['error', 'error']);
    expect(api.activity.reports.at(-1)?.message).toBe(
      'Granola: 1 new, 0 already in Atlas, 1 to try again.',
    );

    const again = await pull();
    expect(again.written).toEqual(['Inbox/Meetings/2026-10-06 Larkspur Payroll renewal.md']);
    expect(again.held).toBe(1);
    expect(meetingFiles()).toEqual([
      'Inbox/Meetings/2026-10-06 From the Notion export.md',
      'Inbox/Meetings/2026-10-06 Larkspur Payroll renewal.md',
      'Inbox/Meetings/2026-10-06 Tobias one on one.md',
    ]);
  });

  it('reads a transcript too large to send inline a page at a time, into one file', async () => {
    const { pull, granola, api, meetingFiles } = pullFixture({ notes: [NEW_1] });
    granola.pageTranscript(NEW_1.id, [
      [granolaTurn('Page one.', '2026-10-06T17:00:00Z', 'me')],
      [granolaTurn('Page two.', '2026-10-06T17:01:00Z')],
      [granolaTurn('Page three.', '2026-10-06T17:02:00Z')],
    ]);

    const report = await pull();

    expect(report.written).toHaveLength(1);
    expect(meetingFiles()).toEqual(
      ['Inbox/Meetings/2026-10-06 From the Notion export.md', ...report.written].sort(),
    );
    expect(granola.count('transcript', NEW_1.id)).toBe(3);
    const text = api.files.get(report.written[0] ?? '')?.text ?? '';
    expect(text).toContain('**You** [13:00:00] Page one. ^t0001');
    expect(text).toContain('[13:01:00] Page two. ^t0002');
    expect(text).toContain('[13:02:00] Page three. ^t0003');
  });

  it('refuses a note whose transcript is past the limit, and moves the watermark past it', async () => {
    const records = memoryRecords();
    const { pull, granola, api } = pullFixture({ notes: [NEW_1], records });
    const long = 'x'.repeat(TRANSCRIPT_LIMIT.characters + 1);
    granola.pageTranscript(NEW_1.id, [[granolaTurn(long, '2026-10-06T17:00:00Z')], []]);

    const report = await pull();

    expect(report.written).toEqual([]);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0]?.problem).toMatch(/transcript is longer than Atlas takes/);
    expect(granola.count('transcript', NEW_1.id)).toBe(1);
    expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
    expect(api.activity.reports[0]).toMatchObject({ level: 'warning' });
  });

  it('stops at a refused key, after the one call, writing nothing and keeping the watermark', async () => {
    const records = memoryRecords({ watermark: '2026-10-10T00:00:00.000Z' });
    const { pull, granola, api, meetingFiles } = pullFixture({ records });
    granola.fail('list', refused(401));

    const report = await pull();

    expect(granola.calls).toHaveLength(1);
    expect(report).toMatchObject({
      ended: 'failed',
      keyRefused: true,
      written: [],
      watermark: '2026-10-10T00:00:00.000Z',
    });
    expect(report.problem).toMatch(/^Granola refused the API key\./);
    expect(meetingFiles()).toEqual(['Inbox/Meetings/2026-10-06 From the Notion export.md']);
    expect(records.current()).toEqual({ watermark: '2026-10-10T00:00:00.000Z', lastPullAt: null });
    expect(api.activity.reports).toEqual([
      expect.objectContaining({
        level: 'error',
        message: expect.stringMatching(/^Granola: the pull failed\. Granola refused the API key\./),
      }),
    ]);
  });

  it('stops at a key refused while fetching a note, leaving the notes after it', async () => {
    const { pull, granola, meetingFiles } = pullFixture({ notes: [NEW_1, NEW_2] });
    granola.fail(`note:${NEW_1.id}`, refused(401));

    const report = await pull();

    expect(report).toMatchObject({ ended: 'stopped', keyRefused: true, written: [] });
    expect(granola.count('note', NEW_2.id)).toBe(0);
    expect(meetingFiles()).toEqual(['Inbox/Meetings/2026-10-06 From the Notion export.md']);
  });

  it('ends when another vault is opened, writing nothing more, and leaves the watermark', async () => {
    const records = memoryRecords();
    const fixture = pullFixture({ notes: [NEW_1, NEW_2], records });
    const { api, pull, granola } = fixture;
    const getNote = granola.port.getNote;
    granola.port.getNote = async (args) => {
      const note = await getNote(args);
      if (args.id === NEW_2.id) api.open = OTHER_VAULT;
      return note;
    };

    const report = await pull();

    expect(report.ended).toBe('vault-changed');
    expect(report.written).toEqual(['Inbox/Meetings/2026-10-06 Larkspur Payroll renewal.md']);
    expect(api.files.has('Inbox/Meetings/2026-10-06 Tobias one on one.md')).toBe(false);
    expect(records.current().watermark).toBeNull();
    expect(api.activity.reports.at(-1)).toMatchObject({
      level: 'warning',
      message: expect.stringMatching(/another vault was opened\. 1 new before it did/),
    });
  });

  it('answers a pull asked for while one runs with that one’s report', async () => {
    const { puller, granola } = pullFixture();
    const first = puller.pull({ vault: VAULT.absolutePath, mode: 'startup' });
    const second = puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });

    expect(await second).toBe(await first);
    expect(granola.count('list')).toBe(1);

    await puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });
    expect(granola.count('list')).toBe(2);
  });

  it('does not start until the vault has been synced in this session, and says nothing', async () => {
    const { pull, granola, api, records } = pullFixture({ synced: false });

    const report = await pull();

    expect(report).toMatchObject({ ended: 'not-synced', written: [], held: 0 });
    expect(granola.calls).toEqual([]);
    expect(api.activity.reports).toEqual([]);
    expect(records.current().lastPullAt).toBeNull();
  });

  it('warns of meetings the webhook should have brought, only from the watermark and only with the webhook on', async () => {
    const late = granolaNote('not_aaaaaaaaaaaaa5', {
      title: 'Late one',
      updatedAt: new Date(START - 3 * HOUR).toISOString(),
    });
    const webhookOn = {
      ...VAULT_FILES,
      '.atlas/settings.md': SETTINGS.replace('---\n\n', 'granola_webhook: true\n---\n\n'),
    };
    const watermark = new Date(START - 4 * HOUR).toISOString();
    const lateLines = (messages: string[]) =>
      messages.filter((message) => /came by the pull/.test(message));

    const fromWatermark = pullFixture({
      notes: [late],
      files: webhookOn,
      records: memoryRecords({ watermark }),
    });
    await fromWatermark.pull('startup');
    expect(lateLines(fromWatermark.messages())).toEqual([
      expect.stringMatching(/^Granola: 1 meeting came by the pull more than 2 hours/),
    ]);

    const fullListing = pullFixture({
      notes: [late],
      files: webhookOn,
      records: memoryRecords({ watermark }),
    });
    await fullListing.pull('sync-now');
    expect(lateLines(fullListing.messages())).toEqual([]);

    const webhookOff = pullFixture({ notes: [late], records: memoryRecords({ watermark }) });
    await webhookOff.pull('startup');
    expect(lateLines(webhookOff.messages())).toEqual([]);
  });

  it('refuses a note the mapper cannot place in time, links it, and moves past it', async () => {
    const records = memoryRecords();
    const timeless = granolaNote('not_aaaaaaaaaaaaa6', {
      title: 'No times at all',
      updatedAt: '2026-10-13T15:30:00Z',
      transcript: [],
    });
    const { pull, api } = pullFixture({ notes: [timeless], records });

    const report = await pull();

    expect(report.refused).toEqual([
      expect.objectContaining({
        id: timeless.id,
        url: `https://notes.granola.ai/d/${timeless.id}`,
        problem: expect.stringMatching(/no start/),
      }),
    ]);
    expect(records.current().watermark).toBe('2026-10-13T15:30:00.000Z');
    expect(api.activity.reports[0]?.message).toMatch(
      /^Granola: “No times at all” was not written: .*Open it in Granola: https:\/\/notes\.granola\.ai\/d\/not_aaaaaaaaaaaaa6$/,
    );
  });

  it('skips a note Granola no longer has, without holding the watermark for it', async () => {
    const records = memoryRecords();
    const { pull, granola } = pullFixture({ notes: [NEW_1], records });
    granola.fail(`note:${NEW_1.id}`, refused(404));

    const report = await pull();

    expect(report.skipped).toEqual([expect.objectContaining({ id: NEW_1.id })]);
    expect(report.failed).toEqual([]);
    expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
  });

  it('fails the pull when Granola cannot be reached for the list, and keeps the watermark', async () => {
    const records = memoryRecords({ watermark: '2026-10-10T00:00:00.000Z' });
    const { pull, granola } = pullFixture({ records });
    granola.fail('list', { kind: 'unreachable', message: 'the network is down' });

    const report = await pull();

    expect(report).toMatchObject({
      ended: 'failed',
      keyRefused: false,
      failure: { kind: 'unreachable' },
      watermark: '2026-10-10T00:00:00.000Z',
    });
    expect(records.current().lastPullAt).toBeNull();
  });

  it('fails the pull on a key that may not list notes, without calling the key refused', async () => {
    const { pull, granola } = pullFixture();
    granola.fail('list', refused(403));

    const report = await pull();

    expect(report).toMatchObject({ ended: 'failed', keyRefused: false, failure: { status: 403 } });
    expect(report.problem).toMatch(/does not let this API key read/);
  });

  it('reports a pull that could not read the vault as failed, in words, and never rejects', async () => {
    const records = memoryRecords({ watermark: '2026-10-10T00:00:00.000Z' });
    const { pull, api } = pullFixture({ records });
    api.deps.index.query = () => Promise.reject(new Error('the index is not ready'));

    const report = await pull();

    expect(report).toMatchObject({
      ended: 'failed',
      failure: null,
      problem: 'the index is not ready',
      watermark: '2026-10-10T00:00:00.000Z',
    });
    expect(api.activity.reports.at(-1)).toMatchObject({
      level: 'error',
      message: 'Granola: the pull failed. The index is not ready.',
    });
  });

  it('asks Granola nothing for a vault that is no longer open', async () => {
    const { pull, api, granola } = pullFixture();
    api.open = OTHER_VAULT;

    const report = await pull();

    expect(report.ended).toBe('vault-changed');
    expect(granola.calls).toEqual([]);
  });

  it('fails the pull on a fault that is not Granola’s, keeping the watermark', async () => {
    const { pull, granola, records } = pullFixture({ notes: [NEW_1] });
    granola.port.getNote = () => Promise.reject(new Error('the adapter broke'));

    const report = await pull();

    expect(report).toMatchObject({ ended: 'failed', problem: 'the adapter broke' });
    expect(records.current().lastPullAt).toBeNull();
  });

  it('leaves a note the vault would not take for the next pull', async () => {
    const records = memoryRecords();
    const { pull, api } = pullFixture({ notes: [NEW_1, NEW_2], records });
    const createNote = api.fs.createNote;
    api.fs.createNote = async (args) => {
      if (args.path.includes('Larkspur')) throw new Error('the disk is full');
      return createNote(args);
    };

    const report = await pull();

    expect(report.failed).toEqual([
      expect.objectContaining({ id: NEW_1.id, url: `https://notes.granola.ai/d/${NEW_1.id}` }),
    ]);
    expect(report.failed[0]?.problem).toMatch(/the disk is full/);
    expect(report.written).toEqual(['Inbox/Meetings/2026-10-06 Tobias one on one.md']);
    expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
  });

  it('puts a failure heard after another vault was opened down to the switch', async () => {
    for (const failure of [refused(401), refused(404), refused(503)]) {
      const { pull, api, granola } = pullFixture({ notes: [NEW_1] });
      granola.port.getNote = async () => {
        api.open = OTHER_VAULT;
        throw new GranolaError(failure);
      };
      const report = await pull();
      expect(report).toMatchObject({
        ended: 'vault-changed',
        keyRefused: false,
        skipped: [],
        failed: [],
      });
    }
    const listing = pullFixture();
    listing.granola.port.listNotes = async () => {
      listing.api.open = OTHER_VAULT;
      throw new GranolaError({ kind: 'invalid', message: 'that vault is not open' });
    };
    expect((await listing.pull()).ended).toBe('vault-changed');
  });
});

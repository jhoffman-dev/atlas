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
} from '@dfai/application';
import { atlasQueryIndex } from '@dfai/application/testing/sqlite';
import {
  mapGranolaNote,
  splitFrontmatter,
  TRANSCRIPT_LIMIT,
  type ActivityReport,
  type GranolaFailure,
  type GranolaNote,
} from '@dfai/domain';
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
  'granola_group_addresses:',
  '  - platform-team@example.com',
  'granola_self_emails:',
  '  - mara.quill@example.com',
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
  // Where meetings land: an older mapping's Inbox/Meetings, and the month's folder the pull writes to.
  const meetingFiles = () =>
    [...api.files.keys()]
      .filter((path) => path.startsWith('Inbox/Meetings/') || path.startsWith('Meetings/'))
      .sort();
  const messages = () => api.activity.reports.map((report) => report.message);
  return { api, granola, clock, waits, records, puller, pull, meetingFiles, messages };
}

const refused = (status: number): GranolaFailure => ({
  kind: 'api_refused',
  status,
  message: `Granola answered ${status}`,
});

/** Every line Activity is told from here on, with the vault it was told in. */
function linesByVault(activity: { inVault: unknown }): (readonly [string, string])[] {
  const lines: (readonly [string, string])[] = [];
  Object.assign(activity, {
    inVault: (vault: string) => ({
      record: (report: ActivityReport) => void lines.push([vault, report.message]),
    }),
  });
  return lines;
}

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
      'Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md',
      'Meetings/2026/10/2026-10-06 Tobias one on one.md',
    ]);
    expect(meetingFiles()).toEqual([
      'Inbox/Meetings/2026-10-06 From the Notion export.md',
      'Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md',
      'Meetings/2026/10/2026-10-06 Tobias one on one.md',
    ]);
    expect(records.current()).toEqual({ watermark: '2026-10-13T17:00:00.000Z', lastPullAt: START });
    expect(messages()).toEqual(['Granola: 2 new, 2 already in DFAI.']);
    // Held by provider and id, so never fetched.
    expect(granola.count('note', HELD.id)).toBe(0);
    expect(granola.count('note', NOTION_ERA.id)).toBe(0);
    expect(granola.count('note')).toBe(2);
  });

  it('writes the bytes n8n writes for the note, with the vault’s zone, groups and the person’s own address', async () => {
    const { pull, api } = pullFixture();
    await pull();

    const written = api.files.get('Meetings/2026/10/2026-10-06 Tobias one on one.md')?.text;
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
    expect(meetingFiles()).toContain('Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md');
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
        problem: 'Granola asked DFAI to slow down.',
      },
    ]);
    expect(report.written).toEqual(['Meetings/2026/10/2026-10-06 Tobias one on one.md']);
    // Not past the note that failed, though a newer one was written.
    expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
    expect(api.activity.reports.map(({ level }) => level)).toEqual(['error', 'error']);
    expect(api.activity.reports.at(-1)?.message).toBe(
      'Granola: 1 new, 0 already in DFAI, 1 to try again.',
    );

    const again = await pull();
    expect(again.written).toEqual(['Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md']);
    expect(again.held).toBe(1);
    expect(meetingFiles()).toEqual([
      'Inbox/Meetings/2026-10-06 From the Notion export.md',
      'Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md',
      'Meetings/2026/10/2026-10-06 Tobias one on one.md',
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
    expect(report.refused[0]?.problem).toMatch(/transcript is longer than DFAI takes/);
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
    expect(report.written).toEqual(['Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md']);
    expect(api.files.has('Meetings/2026/10/2026-10-06 Tobias one on one.md')).toBe(false);
    expect(records.current().watermark).toBeNull();
    expect(api.activity.reports.at(-1)).toMatchObject({
      level: 'warning',
      message: expect.stringMatching(/another vault was opened\. 1 new before it did/),
    });
  });

  it('answers a startup or timed pull asked for while one runs with that one’s report', async () => {
    const { puller, granola } = pullFixture();
    const first = puller.pull({ vault: VAULT.absolutePath, mode: 'startup' });
    const second = puller.pull({ vault: VAULT.absolutePath, mode: 'periodic' });

    expect(await second).toBe(await first);
    expect(granola.count('list')).toBe(1);

    await puller.pull({ vault: VAULT.absolutePath, mode: 'periodic' });
    expect(granola.count('list')).toBe(2);
  });

  it('runs Sync now pressed during a timed pull right after it, once however often it is pressed', async () => {
    const records = memoryRecords({ watermark: '2026-10-13T12:00:00.000Z' });
    const { puller, granola } = pullFixture({ records });
    const timed = puller.pull({ vault: VAULT.absolutePath, mode: 'periodic' });
    const syncNow = puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });
    const pressedAgain = puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });
    const timedAgain = puller.pull({ vault: VAULT.absolutePath, mode: 'periodic' });

    expect(pressedAgain).toBe(syncNow);
    expect(await timedAgain).toBe(await timed);
    const report = await syncNow;
    expect(report.mode).toBe('sync-now');
    expect((await timed).mode).toBe('periodic');
    // The timed pull from the watermark less a day, then Sync now's full listing, and no more.
    expect(granola.calls.filter(({ call }) => call === 'list')).toEqual([
      { call: 'list', updatedAfter: '2026-10-12T12:00:00.000Z', cursor: null },
      { call: 'list', updatedAfter: null, cursor: null },
    ]);
    // The full listing reached the Notion-era note, older than the window: all four held.
    expect((await timed).held).toBe(1);
    expect(report.held).toBe(4);
    expect(report.written).toEqual([]);
  });

  it('shares a Sync now that runs with Sync now pressed again, and with a timed pull', async () => {
    const { puller, granola } = pullFixture();
    const syncNow = puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });
    expect(puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' })).toBe(syncNow);
    expect(puller.pull({ vault: VAULT.absolutePath, mode: 'periodic' })).toBe(syncNow);
    await syncNow;
    expect(granola.count('list')).toBe(1);
  });

  it('starts nothing more once the queued Sync now has run', async () => {
    const { puller, granola } = pullFixture();
    const timed = puller.pull({ vault: VAULT.absolutePath, mode: 'startup' });
    const syncNow = puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });
    await Promise.all([timed, syncNow]);
    expect(granola.count('list')).toBe(2);

    const later = await puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });
    expect(later).not.toBe(await syncNow);
    expect(granola.count('list')).toBe(3);
  });

  it('runs a Sync now queued while another vault is opened to nothing, and says nothing of it in the old vault', async () => {
    const records = memoryRecords({ watermark: '2026-10-13T12:00:00.000Z' });
    const { puller, granola, api } = pullFixture({ notes: [NEW_1, NEW_2], records });
    const lines = linesByVault(api.activity);
    const getNote = granola.port.getNote;
    granola.port.getNote = async (args) => {
      const note = await getNote(args);
      api.open = OTHER_VAULT;
      return note;
    };

    const timed = puller.pull({ vault: VAULT.absolutePath, mode: 'periodic' });
    const syncNow = puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });

    expect(await timed).toMatchObject({ ended: 'vault-changed', mode: 'periodic' });
    expect(await syncNow).toMatchObject({
      ended: 'vault-changed',
      mode: 'sync-now',
      written: [],
      held: 0,
      watermark: '2026-10-13T12:00:00.000Z',
    });
    // Sync now asked Granola nothing: the one listing is the timed pull's.
    expect(granola.count('list')).toBe(1);
    // One line, the timed pull's, which did run; none for the Sync now that never did.
    expect(lines).toEqual([
      [
        VAULT.absolutePath,
        'Granola: the pull stopped when another vault was opened. The next pull in this vault goes on.',
      ],
    ]);
    // The vault is free: a pull of it once it is open again runs.
    api.open = VAULT;
    granola.port.getNote = getNote;
    expect(await puller.pull({ vault: VAULT.absolutePath, mode: 'startup' })).toMatchObject({
      ended: 'pulled',
    });
  });

  it('runs a Sync now queued behind a pull that a fault ended, and gives it its own report', async () => {
    let reads = 0;
    const kept = memoryRecords();
    const records = {
      ...kept,
      read: (vault: string) => {
        reads += 1;
        if (reads === 1) throw new Error('storage is gone');
        return kept.read(vault);
      },
    };
    const { puller, granola, messages } = pullFixture({ notes: [NEW_1], records });

    const startup = puller.pull({ vault: VAULT.absolutePath, mode: 'startup' });
    const syncNow = puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });

    expect(await startup).toMatchObject({ ended: 'failed', problem: 'storage is gone' });
    const report = await syncNow;
    expect(report).not.toBe(await startup);
    expect(report).toMatchObject({
      ended: 'pulled',
      mode: 'sync-now',
      written: ['Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md'],
    });
    expect(granola.count('list')).toBe(1);
    expect(messages()).toEqual([
      'Granola: the pull failed. Storage is gone.',
      'Granola: 1 new, 0 already in DFAI.',
    ]);
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

  it('asks Granola nothing for a vault that is no longer open, and says nothing of it', async () => {
    const { pull, api, granola, messages } = pullFixture();
    api.open = OTHER_VAULT;

    const report = await pull();

    expect(report.ended).toBe('vault-changed');
    expect(granola.calls).toEqual([]);
    expect(messages()).toEqual([]);
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
    expect(report.written).toEqual(['Meetings/2026/10/2026-10-06 Tobias one on one.md']);
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

  it('never keeps a watermark later than now, though a note says it changed in the future', async () => {
    const records = memoryRecords();
    const ahead = granolaNote('not_aaaaaaaaaaaaa7', {
      title: 'From a fast clock',
      updatedAt: new Date(START + 72 * HOUR).toISOString(),
    });
    const { pull } = pullFixture({ notes: [NEW_1, ahead], records });

    const report = await pull();

    expect(report.written).toHaveLength(2);
    expect(report.watermark).toBe(new Date(START).toISOString());
    expect(records.current().watermark).toBe(new Date(START).toISOString());
  });

  it('lists everything, rather than fail, from a kept watermark a day before which is no date', async () => {
    const records = memoryRecords({ watermark: '-271821-04-20T00:00:00.000Z' });
    const { pull, granola } = pullFixture({ records });

    const report = await pull('periodic');

    expect(report.ended).toBe('pulled');
    expect(granola.calls[0]).toEqual({ call: 'list', updatedAfter: null, cursor: null });
    expect(report.written).toHaveLength(2);
  });

  it('leaves out a listed note it cannot read, says so without its content, and takes the rest', async () => {
    const records = memoryRecords();
    const { pull, granola, api, meetingFiles } = pullFixture({ notes: [NEW_1], records });
    const listNotes = granola.port.listNotes;
    granola.port.listNotes = async (args) => ({
      ...(await listNotes(args)),
      unreadable: [{ id: 'not_odd0000000001', reason: 'its updated_at is not text' }],
    });

    const report = await pull();

    expect(report.ended).toBe('pulled');
    expect(meetingFiles()).toContain('Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md');
    expect(report.skipped).toEqual([
      {
        id: 'not_odd0000000001',
        title: null,
        url: null,
        problem:
          'Granola listed a note DFAI cannot read (its updated_at is not text); it was left out of this pull.',
      },
    ]);
    // The note it could not read has no say in the watermark.
    expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
    expect(api.activity.reports.map(({ level, message }) => [level, message])).toEqual([
      [
        'warning',
        'Granola: “not_odd0000000001”: Granola listed a note DFAI cannot read (its updated_at is not text); it was left out of this pull.',
      ],
      ['warning', 'Granola: 1 new, 0 already in DFAI, 1 skipped.'],
    ]);
  });

  it('tells Activity of a note it cannot read once in a session of the app, in each vault', async () => {
    const records = memoryRecords({ watermark: '2026-10-13T12:00:00.000Z' });
    const { puller, granola, api } = pullFixture({ notes: [HELD], records });
    const lines = linesByVault(api.activity);
    const odd = (id: string) => ({ id, reason: 'its updated_at is not text' });
    let unreadable = [odd('not_odd0000000001'), odd('not_odd0000000001')];
    const listNotes = granola.port.listNotes;
    granola.port.listNotes = async (args) => ({ ...(await listNotes(args)), unreadable });
    const pullOf = (mode: 'periodic' | 'sync-now', vault = VAULT.absolutePath) =>
      puller.pull({ vault, mode });
    const skippedLine = (id: string) =>
      `Granola: “${id}”: Granola listed a note DFAI cannot read (its updated_at is not text); it was left out of this pull.`;

    // The first timed pull says it, once though it was listed twice, and counts it.
    const first = await pullOf('periodic');
    expect(first.skipped.map(({ id }) => id)).toEqual(['not_odd0000000001']);
    expect(lines).toEqual([
      [VAULT.absolutePath, skippedLine('not_odd0000000001')],
      [VAULT.absolutePath, 'Granola: nothing new, 1 already in DFAI, 1 skipped.'],
    ]);

    // The next timed pull, whose only skip was said already, is quiet; its report still counts it.
    lines.length = 0;
    const second = await pullOf('periodic');
    expect(second.skipped.map(({ id }) => id)).toEqual(['not_odd0000000001']);
    expect(lines).toEqual([]);

    // A note newly unreadable is said; the old one is not said again.
    unreadable = [odd('not_odd0000000001'), odd('not_odd0000000002')];
    await pullOf('periodic');
    expect(lines).toEqual([
      [VAULT.absolutePath, skippedLine('not_odd0000000002')],
      [VAULT.absolutePath, 'Granola: nothing new, 1 already in DFAI, 2 skipped.'],
    ]);

    // Sync now gets its line, counting both, and says neither note again.
    lines.length = 0;
    await pullOf('sync-now');
    expect(lines).toEqual([
      [VAULT.absolutePath, 'Granola: nothing new, 1 already in DFAI, 2 skipped.'],
    ]);

    // Another vault has its own Activity, and is told.
    lines.length = 0;
    api.open = OTHER_VAULT;
    unreadable = [odd('not_odd0000000001')];
    await pullOf('periodic', OTHER_VAULT.absolutePath);
    expect(lines[0]).toEqual([OTHER_VAULT.absolutePath, skippedLine('not_odd0000000001')]);
  });

  it('does not hold back a note the listing read elsewhere from being said once it is only unreadable', async () => {
    const records = memoryRecords({ watermark: '2026-10-13T12:00:00.000Z' });
    const { puller, granola, api } = pullFixture({ notes: [HELD], records });
    const lines = linesByVault(api.activity);
    const odd = { id: HELD.id, reason: 'its updated_at is not text' };
    let readable = true;
    granola.port.listNotes = async () => ({
      notes: readable ? [HELD] : [],
      unreadable: [odd],
      cursor: null,
    });
    const pullOf = () => puller.pull({ vault: VAULT.absolutePath, mode: 'periodic' });

    // Read and unreadable in one listing: it is read, so neither skipped nor said.
    const first = await pullOf();
    expect(first.skipped).toEqual([]);
    expect(lines).toEqual([]);

    // Listed only unreadable later in the session: said, as a note never said before.
    readable = false;
    await pullOf();
    expect(lines[0]).toEqual([
      VAULT.absolutePath,
      `Granola: “${HELD.id}”: Granola listed a note DFAI cannot read (its updated_at is not text); it was left out of this pull.`,
    ]);
  });

  it('says a list that failed outright was not skipped, and that the next pull lists again', async () => {
    const { pull, granola, api } = pullFixture();
    granola.fail('list', {
      kind: 'malformed',
      message: 'the list of notes is not one DFAI can read',
    });

    const report = await pull();

    expect(report.ended).toBe('failed');
    expect(report.problem).toBe(
      'Granola answered in a way DFAI does not understand: the list of notes is not one DFAI can read. The notes could not be listed; the next pull lists them again.',
    );
    expect(api.activity.reports.map(({ message }) => message).join('\n')).not.toMatch(/skipped/);
  });

  it('refuses a note whose inline transcript is past the limit, and links it in Granola', async () => {
    const records = memoryRecords();
    const giant = granolaNote('not_aaaaaaaaaaaaa8', {
      title: 'All-day offsite',
      updatedAt: '2026-10-13T15:00:00Z',
      transcript: [
        granolaTurn('x'.repeat(TRANSCRIPT_LIMIT.characters + 1), '2026-10-06T17:00:00Z'),
      ],
    });
    const { pull, granola, api, meetingFiles } = pullFixture({ notes: [giant], records });

    const report = await pull();

    expect(report.written).toEqual([]);
    expect(report.refused).toEqual([
      expect.objectContaining({ id: giant.id, url: `https://notes.granola.ai/d/${giant.id}` }),
    ]);
    expect(granola.count('note', giant.id)).toBe(1);
    expect(meetingFiles()).toEqual(['Inbox/Meetings/2026-10-06 From the Notion export.md']);
    expect(api.activity.reports[0]?.message).toMatch(
      /^Granola: “All-day offsite” was not written: its transcript is longer than DFAI takes .* Open it in Granola: https:\/\/notes\.granola\.ai\/d\/not_aaaaaaaaaaaaa8$/,
    );
    expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
  });

  it('links a note whose paged transcript is past the limit in Granola too', async () => {
    const { pull, granola, api } = pullFixture({ notes: [NEW_1] });
    const long = 'x'.repeat(TRANSCRIPT_LIMIT.characters + 1);
    granola.pageTranscript(NEW_1.id, [[granolaTurn(long, '2026-10-06T17:00:00Z')]]);

    const report = await pull();

    expect(report.refused[0]?.url).toBe(`https://notes.granola.ai/d/${NEW_1.id}`);
    expect(api.activity.reports[0]?.message).toMatch(
      /Open it in Granola: https:\/\/notes\.granola\.ai\/d\/not_aaaaaaaaaaaaa1$/,
    );
  });

  it('writes no line for a timed pull that found nothing new, and one for any other pull', async () => {
    const records = memoryRecords({ watermark: '2026-10-13T12:00:00.000Z' });
    const quiet = pullFixture({ notes: [HELD], records });

    const report = await quiet.pull('periodic');

    expect(report).toMatchObject({ ended: 'pulled', held: 1, written: [] });
    expect(quiet.messages()).toEqual([]);
    expect(records.current().lastPullAt).toBe(START);

    await quiet.pull('startup');
    await quiet.pull('sync-now');
    expect(quiet.messages()).toEqual([
      'Granola: nothing new, 1 already in DFAI.',
      'Granola: nothing new, 1 already in DFAI.',
    ]);
  });

  it('takes the person’s own addresses from the setting alone: with none, `me` is the owner’s name', async () => {
    const settings = SETTINGS.replace('granola_self_emails:\n  - mara.quill@example.com\n', '');
    const { pull, api } = pullFixture({
      notes: [NEW_1],
      files: { ...VAULT_FILES, '.atlas/settings.md': settings },
    });

    const report = await pull();

    const written = api.files.get(report.written[0] ?? '')?.text ?? '';
    expect(written).toContain('**Mara Quill** [13:00:00] Morning, Tobias.');
    expect(written).not.toContain('**You**');
    expect(written).toBe(mapGranolaNote(NEW_1, { ...OPTIONS, selfEmails: [] }).content);
  });

  it('maps `me` by the vault’s selfEmails into the same bytes as by the alias it replaces (#173)', async () => {
    const byAlias = pullFixture({ notes: [NEW_1] });
    const bySetting = pullFixture({
      notes: [NEW_1],
      files: {
        ...VAULT_FILES,
        '.atlas/settings.md': SETTINGS.replace('granola_self_emails:', 'selfEmails:'),
      },
    });

    const aliasReport = await byAlias.pull();
    const settingReport = await bySetting.pull();

    const aliasText = byAlias.api.files.get(aliasReport.written[0] ?? '')?.text ?? '';
    const settingText = bySetting.api.files.get(settingReport.written[0] ?? '')?.text ?? '';
    expect(aliasText).toContain('**You** [13:00:00] Morning, Tobias.');
    expect(settingText).toBe(aliasText);
    expect(aliasText).toBe(mapGranolaNote(NEW_1, OPTIONS).content);
  });

  it('maps by selfEmails alone when both are set, the alias left out (#173)', async () => {
    const settings = SETTINGS.replace(
      'granola_self_emails:\n  - mara.quill@example.com\n',
      'selfEmails:\n  - mq@example.org\ngranola_self_emails:\n  - mara.quill@example.com\n',
    );
    const { pull, api } = pullFixture({
      notes: [NEW_1],
      files: { ...VAULT_FILES, '.atlas/settings.md': settings },
    });

    const report = await pull();

    const written = api.files.get(report.written[0] ?? '')?.text ?? '';
    expect(written).not.toContain('**You**');
    expect(written).toBe(
      mapGranolaNote(NEW_1, { ...OPTIONS, selfEmails: ['mq@example.org'] }).content,
    );
  });

  it('stops a pull the Keychain would not give the key for, saying the next pull asks again', async () => {
    const { pull, granola, api } = pullFixture({ notes: [NEW_1, NEW_2] });
    granola.fail(`note:${NEW_1.id}`, { kind: 'keychain', message: 'the Keychain is locked' });

    const report = await pull();

    expect(report.ended).toBe('stopped');
    expect(granola.count('note', NEW_2.id)).toBe(0);
    expect(api.activity.reports.at(-1)?.message).toBe(
      'Granola: the pull stopped. The Keychain did not give DFAI the Granola API key: the Keychain is locked. Unlock the Keychain, or paste the key again in Settings → Granola. DFAI stops pulling; the next pull asks again.',
    );
  });

  describe('when Granola keeps asking DFAI to slow down', () => {
    const notes = [1, 2, 3, 4].map((at) =>
      granolaNote(`not_cccccccccccc0${at}`, {
        title: `Standup ${at}`,
        updatedAt: `2026-10-13T1${at}:00:00Z`,
      }),
    );
    const slowDowns = () => Array.from({ length: 6 }, () => refused(429));

    it('ends the pull failed after three notes in a row, holding the watermark, and says why', async () => {
      const records = memoryRecords({ watermark: '2026-10-12T00:00:00.000Z' });
      const { pull, granola, api, waits } = pullFixture({ notes, records });
      for (const note of notes) granola.fail(`note:${note.id}`, ...slowDowns());

      const report = await pull();

      expect(report).toMatchObject({
        ended: 'failed',
        failure: { kind: 'api_refused', status: 429 },
        watermark: '2026-10-12T00:00:00.000Z',
        written: [],
      });
      expect(report.failed.map(({ id }) => id)).toEqual(notes.slice(0, 3).map(({ id }) => id));
      expect(granola.count('note', notes[3]!.id)).toBe(0);
      expect(records.current()).toEqual({
        watermark: '2026-10-12T00:00:00.000Z',
        lastPullAt: null,
      });
      // Each of the three waited out its own backoff: 1 + 2 + 4 + 8 + 16 seconds.
      expect(waits.filter((wait) => wait >= 1_000)).toHaveLength(15);
      expect(api.activity.reports.at(-1)).toEqual(
        expect.objectContaining({
          level: 'error',
          message:
            'Granola: the pull failed. Granola asked DFAI to slow down for 3 notes in a row, so DFAI stopped this pull. The next pull tries those notes again.',
        }),
      );
    });

    it('goes on when a note between them comes through', async () => {
      const { pull, granola } = pullFixture({ notes });
      for (const note of [notes[0]!, notes[1]!, notes[3]!]) {
        granola.fail(`note:${note.id}`, ...slowDowns());
      }

      const report = await pull();

      expect(report.ended).toBe('pulled');
      expect(report.failed).toHaveLength(3);
      expect(report.written).toHaveLength(1);
    });

    it('counts only notes refused with 429 in a row, not other failures', async () => {
      const { pull, granola } = pullFixture({ notes });
      granola.fail(`note:${notes[0]!.id}`, ...slowDowns());
      granola.fail(`note:${notes[1]!.id}`, ...slowDowns());
      granola.fail(`note:${notes[2]!.id}`, refused(503));
      granola.fail(`note:${notes[3]!.id}`, ...slowDowns());

      const report = await pull();

      expect(report.ended).toBe('pulled');
      expect(report.failed).toHaveLength(4);
    });
  });

  describe('a fault outside the pull itself', () => {
    it('is a failed report, said in Activity, when the ports cannot be had', async () => {
      const api = apiFixture({ files: VAULT_FILES, markdown: remarkMarkdown });
      const puller = createGranolaPuller({
        ports: () => {
          throw new Error('no vault is wired yet');
        },
        clock: { now: () => START },
        wait: async () => {},
        activity: api.activity,
        openVault: () => VAULT.absolutePath,
        syncedThisSession: () => true,
      });

      const report = await puller.pull({ vault: VAULT.absolutePath, mode: 'startup' });

      expect(report).toEqual({
        vault: VAULT.absolutePath,
        mode: 'startup',
        ended: 'failed',
        written: [],
        held: 0,
        refused: [],
        skipped: [],
        failed: [],
        failure: null,
        problem: 'no vault is wired yet',
        keyRefused: false,
        watermark: null,
      });
      expect(api.activity.reports.map(({ message }) => message)).toEqual([
        'Granola: the pull failed. No vault is wired yet.',
      ]);
      // The puller is free for the next pull.
      await expect(
        puller.pull({ vault: VAULT.absolutePath, mode: 'startup' }),
      ).resolves.toMatchObject({ ended: 'failed' });
    });

    it('is a failed report that says so when Activity cannot be had either', async () => {
      const puller = createGranolaPuller({
        ports: () => {
          throw new Error('no vault is wired yet');
        },
        clock: { now: () => START },
        wait: async () => {},
        activity: {
          inVault: () => {
            throw new Error('Activity is closed');
          },
        } as never,
        openVault: () => VAULT.absolutePath,
        syncedThisSession: () => {
          throw new Error('unreachable');
        },
      });

      const report = await puller.pull({ vault: VAULT.absolutePath, mode: 'sync-now' });

      expect(report).toMatchObject({
        ended: 'failed',
        problem: 'no vault is wired yet; Activity could not record it either: Activity is closed',
      });
    });

    it('keeps what the pull did when the watermark cannot be kept, and does not claim it moved', async () => {
      const kept = memoryRecords({ watermark: '2026-10-10T00:00:00.000Z' });
      const records = {
        ...kept,
        write: () => {
          throw new Error('the quota is full');
        },
      };
      const { pull, granola, meetingFiles, messages } = pullFixture({ records });
      const listNotes = granola.port.listNotes;
      granola.port.listNotes = async (args) => ({
        ...(await listNotes(args)),
        unreadable: [{ id: 'not_odd0000000001', reason: 'its title is not text' }],
      });

      const report = await pull('sync-now');

      expect(meetingFiles()).toContain('Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md');
      expect(report).toMatchObject({
        ended: 'failed',
        problem: 'the quota is full',
        held: 2,
        skipped: [expect.objectContaining({ id: 'not_odd0000000001' })],
        // The watermark the record still holds: the one the pull could not move.
        watermark: '2026-10-10T00:00:00.000Z',
      });
      expect(report.written).toEqual([
        'Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md',
        'Meetings/2026/10/2026-10-06 Tobias one on one.md',
      ]);
      expect(kept.current().watermark).toBe('2026-10-10T00:00:00.000Z');
      expect(messages().at(-1)).toBe(
        'Granola: the pull failed. The quota is full. 2 new before it did.',
      );
    });

    it('reports the watermark it moved when Activity fails only at the end', async () => {
      const records = memoryRecords({ watermark: '2026-10-10T00:00:00.000Z' });
      const { pull, api } = pullFixture({ notes: [NEW_1], records });
      Object.assign(api.activity, {
        inVault: () => ({
          record: (line: ActivityReport) => {
            if (line.message.startsWith('Granola: 1 new')) throw new Error('Activity is full');
          },
        }),
      });

      const report = await pull();

      expect(report).toMatchObject({
        ended: 'failed',
        written: ['Meetings/2026/10/2026-10-06 Larkspur Payroll renewal.md'],
        watermark: '2026-10-13T15:00:00.000Z',
      });
      expect(records.current().watermark).toBe('2026-10-13T15:00:00.000Z');
    });

    it('keeps the refused key and Granola’s failure when Activity fails at the end', async () => {
      const { pull, granola, api } = pullFixture();
      granola.fail('list', refused(401));
      Object.assign(api.activity, {
        inVault: () => ({
          record: () => {
            throw new Error('Activity is full');
          },
        }),
      });

      const report = await pull();

      expect(report).toMatchObject({
        ended: 'failed',
        failure: refused(401),
        keyRefused: true,
      });
    });

    it('is a failed report when the pull’s own record cannot be read', async () => {
      const { puller } = pullFixture({
        records: {
          read: () => {
            throw new Error('storage is gone');
          },
          write: () => {},
          current: () => ({ watermark: null, lastPullAt: null }),
        },
      });
      await expect(
        puller.pull({ vault: VAULT.absolutePath, mode: 'startup' }),
      ).resolves.toMatchObject({ ended: 'failed', problem: 'storage is gone' });
    });
  });
});

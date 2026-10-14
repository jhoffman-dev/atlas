/**
 * Adversarial tests for the Granola pull (P28-11), left failing for the fixer.
 * Each one is a defect found against ADR-0034. All names are made up.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  apiFixture,
  createGranolaPuller,
  fakeGranola,
  granolaNote,
  granolaTurn,
  type GranolaPort,
  type GranolaPullRecord,
  type GranolaPullRecords,
} from '@atlas/application';
import { atlasQueryIndex } from '@atlas/application/testing/sqlite';
import { TRANSCRIPT_LIMIT, unreadableSummaryProblem, type GranolaNote } from '@atlas/domain';
import { remarkMarkdown } from '../markdown/markdown-port.ts';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const { tauriGranola } = await import('./tauri-granola.ts');

const VAULT = '/Users/j/Vault';
const START = Date.UTC(2026, 9, 13, 18);
const HOUR = 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const FILES: Record<string, string> = {
  '.atlas/settings.md': [
    '---',
    'profileName: Mara Quill',
    'granola_time_zone: America/New_York',
    '---',
    '',
    '# Settings',
    '',
  ].join('\n'),
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

function pullFixture({
  notes = [],
  files = FILES,
  records = memoryRecords(),
  now = START,
  port,
}: {
  notes?: readonly GranolaNote[];
  files?: Record<string, string>;
  records?: ReturnType<typeof memoryRecords>;
  now?: number;
  port?: GranolaPort;
} = {}) {
  const api = apiFixture({
    files,
    markdown: remarkMarkdown,
    index: { query: atlasQueryIndex({ files, markdown: remarkMarkdown }) },
  });
  const granola = fakeGranola({ notes });
  const clock = { now };
  const puller = createGranolaPuller({
    ports: () => ({
      fs: api.fs,
      markdown: remarkMarkdown,
      index: api.deps.index,
      granola: port ?? granola.port,
      records,
    }),
    clock: { now: () => clock.now },
    wait: async (milliseconds) => {
      clock.now += milliseconds;
    },
    activity: api.activity,
    openVault: () => api.open?.absolutePath ?? null,
    syncedThisSession: () => true,
  });
  const meetingFiles = () =>
    [...api.files.keys()].filter((path) => path.startsWith('Inbox/Meetings/')).sort();
  const vaultFiles = () =>
    Object.fromEntries([...api.files].map(([path, { text }]) => [path, text]));
  return { api, granola, records, puller, meetingFiles, vaultFiles };
}

describe('Granola pull: attacks', () => {
  it('never moves the watermark past now, so one note stamped in the future does not blind later pulls', async () => {
    // Granola's clock (or a bad row) puts one note three days ahead.
    const skewed = granolaNote('not_skew000000001', {
      title: 'Skewed',
      updatedAt: iso(START + 72 * HOUR),
    });
    const records = memoryRecords();
    const first = pullFixture({ notes: [skewed], records });
    await first.puller.pull({ vault: VAULT, mode: 'startup' });

    // An hour later a new meeting is in Granola; the 15-minute pull runs.
    const fresh = granolaNote('not_fresh00000001', {
      title: 'Fresh',
      updatedAt: iso(START + HOUR),
    });
    const later = pullFixture({
      notes: [skewed, fresh],
      files: first.vaultFiles(),
      records,
      now: START + HOUR,
    });
    const report = await later.puller.pull({ vault: VAULT, mode: 'periodic' });

    // Today: the watermark is 2026-10-16T18:00Z, the pull lists from 2026-10-15T18:00Z,
    // and "Fresh" is not listed — nor will it be by any timed pull for three days.
    expect(report.written).toEqual(['Inbox/Meetings/2026-10-06 Fresh.md']);
  });

  it('gives Sync now its full listing even when pressed while a timed pull runs', async () => {
    // The person sees a meeting from September missing and presses Sync now,
    // just as the 15-minute pull (from the watermark less a day) starts.
    const missing = granolaNote('not_old0000000001', {
      title: 'September planning',
      updatedAt: '2026-09-01T10:00:00Z',
    });
    const recent = granolaNote('not_recent0000001', {
      title: 'Recent',
      updatedAt: '2026-10-13T10:00:00Z',
    });
    const { puller, meetingFiles } = pullFixture({
      notes: [missing, recent],
      records: memoryRecords({ watermark: '2026-10-12T00:00:00.000Z' }),
    });

    const periodic = puller.pull({ vault: VAULT, mode: 'periodic' });
    const syncNow = await puller.pull({ vault: VAULT, mode: 'sync-now' });
    await periodic;

    // Today: Sync now is answered with the periodic pull's report (mode 'periodic'),
    // no full listing ever runs, and the September meeting stays missing.
    expect(meetingFiles()).toContain('Inbox/Meetings/2026-10-06 September planning.md');
    expect(syncNow.mode).toBe('sync-now');
  });

  it('takes the readable notes of a page when one note in it is not as documented', async () => {
    invoke.mockReset();
    const good = granolaNote('not_good000000001', {
      title: 'Good',
      updatedAt: '2026-10-13T10:00:00Z',
    });
    invoke.mockImplementation(async (_command: string, args: { path: string }) => {
      if (args.path === '/v1/notes') {
        return {
          status: 200,
          body: JSON.stringify({
            notes: [
              { id: good.id, object: 'note', title: good.title, updated_at: good.updated_at },
              // One note Granola sends without its updated_at.
              { id: 'not_odd0000000001', object: 'note', title: 'Odd', updated_at: null },
            ],
            hasMore: false,
            cursor: null,
          }),
        };
      }
      return { status: 200, body: JSON.stringify(good) };
    });
    const { puller, meetingFiles, api } = pullFixture({ port: tauriGranola });

    const report = await puller.pull({ vault: VAULT, mode: 'sync-now' });

    // ADR-0034: "A Granola API change reaches us as a refused or failed note."
    // Today the whole listing is malformed: the pull fails, "Good" is never written,
    // and every later pull (Sync now included) fails the same way.
    expect(report.ended).toBe('pulled');
    expect(meetingFiles()).toEqual(['Inbox/Meetings/2026-10-06 Good.md']);
    // And the failed pull's line tells the person something that is not so.
    expect(api.activity.reports.map((line) => line.message).join('\n')).not.toMatch(
      /It was skipped; Sync now tries it again/,
    );
  });

  it('refuses a transcript past the limit whether Granola sends it inline or in pages', async () => {
    const turns = [
      granolaTurn('x'.repeat(TRANSCRIPT_LIMIT.characters + 1), '2026-10-06T17:00:00Z', 'me'),
      granolaTurn('Bye.', '2026-10-06T17:30:00Z'),
    ];
    const inline = granolaNote('not_inline0000001', {
      title: 'Inline giant',
      updatedAt: '2026-10-13T10:00:00Z',
      transcript: turns,
    });
    const paged = granolaNote('not_paged00000001', {
      title: 'Paged giant',
      updatedAt: '2026-10-13T10:00:00Z',
    });
    const { puller, granola } = pullFixture({ notes: [inline, paged] });
    granola.pageTranscript(paged.id, [turns]);

    const report = await puller.pull({ vault: VAULT, mode: 'startup' });

    // Today the paged one is refused, but the inline one (up to the host's 16 MiB cap)
    // is written: a 5 MB+ meeting file lands in the synced vault.
    expect(report.refused.map(({ id }) => id).sort()).toEqual([inline.id, paged.id].sort());
    expect(report.written).toEqual([]);
  });

  it('never rejects, and frees the vault, when a port throws a value that cannot be put into words', async () => {
    // A port that rejects with something other than an Error: here a null-prototype object,
    // which String() cannot convert. The fault lands in faultReport, whose own
    // messageWithoutPaths(cause) throws, so the "never rejects" pull rejects.
    const { puller } = pullFixture({
      records: {
        ...memoryRecords(),
        read: () => {
          throw Object.create(null) as unknown;
        },
      },
    });

    const timed = puller.pull({ vault: VAULT, mode: 'periodic' });
    const syncNow = puller.pull({ vault: VAULT, mode: 'sync-now' });

    // Today: rejects with "TypeError: Cannot convert object to primitive value".
    await expect(timed).resolves.toMatchObject({ ended: 'failed' });
    // Today: the flight is never cleared, so every later pull of the vault is handed the
    // same rejected promise until the app restarts, and the queued Sync now never settles.
    expect(puller.pull({ vault: VAULT, mode: 'startup' })).not.toBe(timed);
    const settled = await Promise.race([
      syncNow.then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise((resolve) => setTimeout(() => resolve('hangs'), 100)),
    ]);
    expect(settled).toBe('settled');
  });

  it('reports the meetings it wrote when a fault comes after they were written', async () => {
    // The watermark cannot be kept (localStorage full: QuotaExceededError) after the note is
    // written. faultReport starts from nothing, so the report and Activity say no meeting
    // came, though one is in the vault.
    const note = granolaNote('not_quota00000001', {
      title: 'Quota',
      updatedAt: '2026-10-13T10:00:00Z',
    });
    const { puller, meetingFiles, api } = pullFixture({
      notes: [note],
      records: {
        ...memoryRecords(),
        write: () => {
          throw new Error('QuotaExceededError: the quota has been exceeded');
        },
      },
    });

    const report = await puller.pull({ vault: VAULT, mode: 'sync-now' });

    expect(meetingFiles()).toEqual(['Inbox/Meetings/2026-10-06 Quota.md']);
    expect(report.ended).toBe('failed');
    // Today: written is [] and the line is "Granola: the pull failed. QuotaExceededError: …"
    // with no word of the meeting it brought.
    expect(report.written).toEqual(['Inbox/Meetings/2026-10-06 Quota.md']);
    expect(api.activity.reports.at(-1)?.message).toMatch(/1 new before it did/);
  });

  it('shows an unreadable id with no control character, no bidi override and no half an emoji', () => {
    // shownId strips C0 controls and DEL only; C1 controls (U+0085 NEL), bidi overrides
    // (U+202E) and a cut through a surrogate pair reach Activity and the report.
    const controls = unreadableSummaryProblem({ id: 'not_‮evil\u0085x', reason: 'r' }).id;
    expect(controls).not.toMatch(/[\u0080-\u009f‪-‮⁦-⁩]/);
    const emoji = unreadableSummaryProblem({ id: `${'a'.repeat(39)}🙂tail`, reason: 'r' }).id;
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

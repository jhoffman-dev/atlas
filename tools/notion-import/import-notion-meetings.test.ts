import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { remarkMarkdown } from '@atlas/adapters';
import { splitFrontmatter, validateMeetingImport, type MeetingImport } from '@atlas/domain';
import {
  ImportSetupError,
  importNotionMeetings,
  type ImportOptions,
  type RowOutcome,
} from './import-notion-meetings.ts';
import { meetingPaths } from '../../packages/domain/src/meetings/mapping/meeting-file-name.ts';
import { NotionExportError } from './notion-meetings.ts';

/*
 * The importer over a small Notion export (fixtures/export, every name in it
 * made up) and a real folder standing in for a vault copy: what it writes is
 * held to the contract by the validator Atlas runs and by the JSON Schema.
 */

const FIXTURE = fileURLToPath(new URL('fixtures/export/', import.meta.url));
const CSV_NAME = 'Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54_all.csv';
const PAGES = 'Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54';
const MEETINGS = 'Inbox/Meetings';

const schemaFile = new URL(
  '../../vault/docs/contracts/meeting-import-v1.schema.json',
  import.meta.url,
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaAccepts = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')) as object);

/** The meeting as Atlas reads it; fails the test with every problem when the file breaks the contract. */
function accepted(content: string): MeetingImport {
  const result = validateMeetingImport({
    text: content,
    selfName: null,
    readFrontmatter: (frontmatter) => ({
      properties: remarkMarkdown.frontmatterProperties(frontmatter),
      problem: remarkMarkdown.frontmatterProblem(frontmatter),
    }),
  });
  if (!result.ok) throw new Error(`refused:\n${JSON.stringify(result.errors, null, 2)}`);
  const frontmatter = remarkMarkdown.frontmatterProperties(splitFrontmatter(content).frontmatter);
  expect(schemaAccepts(frontmatter), ajv.errorsText(schemaAccepts.errors)).toBe(true);
  return result.meeting;
}

/** A turn's time as written, or null when it has none. */
const timeText = ({ time }: MeetingImport['transcript'][number]) =>
  'text' in time ? time.text : null;

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-import-')));
  exportDir = join(root, 'export');
  vault = join(root, 'vault copy');
  await cp(FIXTURE, exportDir, { recursive: true });
  await mkdir(vault);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const options = (overrides: Partial<ImportOptions> = {}): ImportOptions => ({
  csv: join(exportDir, CSV_NAME),
  vault,
  folder: MEETINGS,
  timeZone: 'America/Los_Angeles',
  groupAddresses: [],
  // The fixture's Platform weekly sync and 1:1s are Gemini's: held without this (issue #44).
  geminiDates: 'arrival-local',
  ...overrides,
});

const run = (overrides?: Partial<ImportOptions>) => importNotionMeetings(options(overrides));

const kinds = (outcomes: readonly RowOutcome[]) => outcomes.map((outcome) => outcome.kind);
const written = async () => (await readdir(join(vault, MEETINGS))).sort();
const read = (path: string) => readFile(join(vault, path), 'utf8');

/** The export's CSV with its rows replaced; the header stays the fixture's. */
async function rewriteCsv(rows: readonly string[]) {
  const csv = join(exportDir, CSV_NAME);
  const [header] = (await readFile(csv, 'utf8')).split('\r\n');
  await writeFile(csv, [header, ...rows, ''].join('\r\n'));
}

async function addPage(name: string, text: string | Buffer) {
  await writeFile(join(exportDir, PAGES, name), text);
}

describe('importing a Notion Meeting Notes export', () => {
  it('writes one contract file per row with a Source ID, each one Atlas lets in', async () => {
    const outcomes = await run();

    expect(kinds(outcomes)).toEqual(['written', 'written', 'written', 'written', 'no-source-id']);
    expect(await written()).toEqual([
      '2026-10-01 Larkspur Payroll renewal, final terms.md',
      '2026-10-02 1 1 (gemini da17a49f).md',
      '2026-10-02 1 1.md',
      '2026-10-06 Platform weekly sync.md',
    ]);
    for (const outcome of outcomes) {
      if (outcome.kind === 'written') accepted(await read(outcome.path));
    }
  });

  it('maps the CSV’s properties and the page’s sections into the meeting', async () => {
    await run();

    const sync = accepted(await read(`${MEETINGS}/2026-10-06 Platform weekly sync.md`));
    expect(sync).toMatchObject({
      title: 'Platform weekly sync',
      date: '2026-10-06',
      kind: 'Standup',
      provider: 'gemini',
      externalId: '18c2f4a9e7b3d501',
      transcriptClock: 'elapsed',
    });
    expect(sync.attendees.map((each) => [each.email, each.group])).toEqual([
      ['mara.quill@example.com', false],
      ['tobias.fenn@example.com', false],
      ['platform-team@example.com', true],
    ]);
    expect(sync.nextSteps.map((step) => step.owner)).toEqual(['Tobias Fenn', 'Mara Quill']);
    expect(sync.transcript.map((turn) => [turn.writtenSpeaker, timeText(turn)])).toEqual([
      ['Mara Quill', '00:00:12'],
      ['Tobias Fenn', '00:00:12'],
      ['Mara Quill', '00:09:44'],
    ]);
  });

  it('holds Gemini’s rows, whose Dates are when the notes arrived, unless told how to read them', async () => {
    const outcomes = await importNotionMeetings({
      csv: join(exportDir, CSV_NAME),
      vault,
      folder: MEETINGS,
      timeZone: 'America/Los_Angeles',
      groupAddresses: [],
    });

    expect(kinds(outcomes)).toEqual(['held', 'written', 'held', 'held', 'no-source-id']);
    expect(outcomes[0]).toMatchObject({
      reason: 'gemini dates need --gemini-dates (issue #44)',
    });
    expect(await written()).toEqual(['2026-10-01 Larkspur Payroll renewal, final terms.md']);
  });

  it('starts a Gemini meeting its transcript’s length before its notes arrived, and says so', async () => {
    await run();

    const text = await read(`${MEETINGS}/2026-10-06 Platform weekly sync.md`);
    // Arrived 10:00; the transcript's last section stamp is 00:09:44; the Date's range end is not the meeting's.
    expect(accepted(text)).toMatchObject({ date: '2026-10-06', start: '09:50', end: null });
    expect(text).toContain(
      "## Notes\n\nStart time approximate: Gemini's date in Notion is when its notes arrived (10:00), and the start written here is that less the transcript's last time stamp, 00:09:44 (issue #44).\n\n- Cache rollout:",
    );
  });

  it('reads a Gemini Date’s Z as local time, and with no transcript starts it when the notes arrived', async () => {
    await run();

    const text = await read(`${MEETINGS}/2026-10-02 1 1.md`);
    expect(accepted(text)).toMatchObject({ date: '2026-10-02', start: '09:00' });
    expect(text).toContain(
      'the transcript has no time stamps, so the start written here is that time',
    );
  });

  it('brings in only the providers it is told to', async () => {
    const outcomes = await run({ providers: ['granola'] });

    expect(kinds(outcomes)).toEqual([
      'left-out',
      'written',
      'left-out',
      'left-out',
      'no-source-id',
    ]);
    expect(outcomes[0]).toMatchObject({ reason: 'gemini is not among --providers' });
    expect(await written()).toEqual(['2026-10-01 Larkspur Payroll renewal, final terms.md']);
  });

  it('reads a UTC Date on the clock of the time zone, and a toggle’s transcript turn by turn', async () => {
    await run();

    const text = await read(`${MEETINGS}/2026-10-01 Larkspur Payroll renewal, final terms.md`);
    const call = accepted(text);
    expect(call).toMatchObject({
      title: 'Larkspur Payroll: renewal, "final" terms',
      date: '2026-10-01',
      start: '14:14',
      provider: 'granola',
      transcriptClock: 'wall',
    });
    expect(call.transcript.map((turn) => [turn.writtenSpeaker, timeText(turn)])).toEqual([
      ['You', '14:14:22'],
      ['Unknown', '14:14:40'],
      ['You', '14:15:02'],
    ]);
  });

  it('keeps a section the mapping has no place for, under its own heading in Notes', async () => {
    await run();

    const text = await read(`${MEETINGS}/2026-10-01 Larkspur Payroll renewal, final terms.md`);
    expect(text).toContain(
      '## Notes\n\n### Meeting summary (written up afterwards)\n\nLarkspur Payroll will sign',
    );
    expect(text).not.toContain('Chat with meeting transcript');
  });

  it('puts the second meeting of a title on one day at its own path, as n8n does', async () => {
    await run();

    expect(accepted(await read(`${MEETINGS}/2026-10-02 1 1.md`)).externalId).toBe(
      '18c3a0b6d2e4f710',
    );
    expect(accepted(await read(`${MEETINGS}/2026-10-02 1 1 (gemini da17a49f).md`)).externalId).toBe(
      '18c3a7c1e9f2b844',
    );
  });

  it('names a row without a Source ID rather than giving it one', async () => {
    const outcomes = await run();

    expect(outcomes.at(-1)).toEqual({
      kind: 'no-source-id',
      row: { title: 'Notes from the offsite', date: 'September 30, 2026' },
    });
    expect((await written()).join()).not.toContain('offsite');
  });
});

describe('running the import again', () => {
  it('writes nothing new over the same export', async () => {
    await run();
    const first = await Promise.all((await written()).map((name) => read(`${MEETINGS}/${name}`)));

    const again = await run();

    expect(kinds(again)).toEqual(['in-vault', 'in-vault', 'in-vault', 'in-vault', 'no-source-id']);
    expect(await Promise.all((await written()).map((name) => read(`${MEETINGS}/${name}`)))).toEqual(
      first,
    );
  });

  it('writes nothing for a meeting Atlas has since stamped, filed elsewhere or archived', async () => {
    await run();
    const stamp = (text: string) =>
      text.replace(/^(atlas_import: .*\n)/m, '$1atlas_import_outcome: imported\n');
    const sync = `${MEETINGS}/2026-10-06 Platform weekly sync.md`;
    await writeFile(join(vault, sync), stamp(await read(sync)));
    await mkdir(join(vault, 'Meetings/2026'), { recursive: true });
    await rename(
      join(vault, `${MEETINGS}/2026-10-02 1 1.md`),
      join(vault, 'Meetings/2026/Career goals.md'),
    );
    await mkdir(join(vault, 'Archive', MEETINGS), { recursive: true });
    await rename(
      join(vault, `${MEETINGS}/2026-10-02 1 1 (gemini da17a49f).md`),
      join(vault, 'Archive', MEETINGS, '2026-10-02 1 1 (gemini da17a49f).md'),
    );

    const again = await run();

    expect(again.slice(0, 4).map((outcome) => ('path' in outcome ? outcome.path : null))).toEqual([
      sync,
      `${MEETINGS}/2026-10-01 Larkspur Payroll renewal, final terms.md`,
      'Meetings/2026/Career goals.md',
      `Archive/${MEETINGS}/2026-10-02 1 1 (gemini da17a49f).md`,
    ]);
    expect(kinds(again)).toEqual(['in-vault', 'in-vault', 'in-vault', 'in-vault', 'no-source-id']);
    expect(await written()).toEqual([
      '2026-10-01 Larkspur Payroll renewal, final terms.md',
      '2026-10-06 Platform weekly sync.md',
    ]);
  });

  it('writes a meeting two rows name once, however differently the rows title it', async () => {
    await rewriteCsv([
      'Platform weekly sync,,Standup,Mara Quill,"October 6, 2026 10:00 AM",gemini,18c2f4a9e7b3d501',
      'Platform sync (renamed),,Standup,Mara Quill,"October 6, 2026 10:00 AM",gemini,18c2f4a9e7b3d501',
    ]);

    const outcomes = await run();

    expect(outcomes[1]).toMatchObject({
      kind: 'in-vault',
      path: `${MEETINGS}/2026-10-06 Platform weekly sync.md`,
    });
    expect(await written()).toEqual(['2026-10-06 Platform weekly sync.md']);
  });

  it('knows a meeting by its trimmed external_id, as the import does', async () => {
    await mkdir(join(vault, 'Meetings'));
    await writeFile(
      join(vault, 'Meetings/Kept by hand.md'),
      "---\ntype: meeting\natlas_import_outcome: imported\nprovider: gemini\nexternal_id: ' 18c2f4a9e7b3d501 '\n---\n",
    );

    const outcomes = await run();

    expect(outcomes[0]).toMatchObject({ kind: 'in-vault', path: 'Meetings/Kept by hand.md' });
  });

  it('does not count a hidden folder’s copy as the vault holding the meeting', async () => {
    await mkdir(join(vault, '.trash'));
    await writeFile(
      join(vault, '.trash/Platform weekly sync.md'),
      "---\ntype: meeting\natlas_import_outcome: imported\nprovider: gemini\nexternal_id: '18c2f4a9e7b3d501'\n---\n",
    );

    const outcomes = await run();

    expect(outcomes[0]).toMatchObject({ kind: 'written' });
  });
});

describe('rows the import refuses, and says why', () => {
  it('refuses a row whose page is not in the export', async () => {
    await rewriteCsv([
      'Retro,,Retro,Mara Quill,"October 3, 2026 4:00 PM",granola,not_nowhere000001',
    ]);

    const [outcome] = await run();

    expect(outcome).toEqual({
      kind: 'refused',
      row: { title: 'Retro', date: 'October 3, 2026 4:00 PM' },
      reason: 'no page in the export holds Source ID not_nowhere000001',
    });
  });

  it('refuses a row two pages claim, rather than picking one', async () => {
    const page = await readFile(
      join(exportDir, PAGES, 'Platform weekly sync 7c41e0d2a9b84f6e9d3a1c5b7e2f8a06.md'),
      'utf8',
    );
    await addPage('Platform weekly sync (copy) 0000000000000000000000000000aaaa.md', page);

    const [outcome] = await run();

    expect(outcome).toMatchObject({
      kind: 'refused',
      reason: 'two pages in the export hold Source ID 18c2f4a9e7b3d501',
    });
  });

  it('refuses a meeting with no start time instead of inventing one, and imports the rest', async () => {
    await rewriteCsv([
      'Day only,,Standup,Mara Quill,"October 7, 2026",gemini,18c2f4a9e7b3d501',
      '1:1,,1on1,Mara Quill,"October 2, 2026 9:00 AM",gemini,18c3a0b6d2e4f710',
    ]);

    const outcomes = await run();

    expect(outcomes[0]).toEqual({
      kind: 'refused',
      row: { title: 'Day only', date: 'October 7, 2026' },
      reason: 'start: the meeting has no start time (pass `start`)',
    });
    expect(kinds(outcomes)).toEqual(['refused', 'written']);
    expect(await written()).toEqual(['2026-10-02 1 1.md']);
  });

  it('refuses a meeting when other meetings hold both of its paths, writing over neither', async () => {
    const paths = meetingPaths({
      date: '2026-10-06',
      title: 'Platform weekly sync',
      provider: 'gemini',
      externalId: '18c2f4a9e7b3d501',
    });
    const other = "---\nprovider: gemini\nexternal_id: 'someone-else'\n---\n";
    await mkdir(join(vault, MEETINGS), { recursive: true });
    await writeFile(join(vault, paths.path), other);
    await writeFile(join(vault, paths.collisionPath), other);

    const [outcome] = await run();

    expect(outcome).toMatchObject({
      kind: 'refused',
      reason: 'another meeting holds both of its paths in Inbox/Meetings',
    });
    expect([await read(paths.path), await read(paths.collisionPath)]).toEqual([other, other]);
  });

  it('passes by a file that names the meeting but holds nothing by the import’s rule, writing beside it', async () => {
    const paths = meetingPaths({
      date: '2026-10-06',
      title: 'Platform weekly sync',
      provider: 'gemini',
      externalId: '18c2f4a9e7b3d501',
    });
    // YAML that does not read holds nothing to the import on arrival (P28-04), so it does not here either.
    const unreadable =
      "---\nprovider: 'gemini'\nexternal_id: '18c2f4a9e7b3d501'\ntitle: [unclosed\n---\n";
    await mkdir(join(vault, MEETINGS), { recursive: true });
    await writeFile(join(vault, paths.path), unreadable);

    const [outcome] = await run();

    expect(outcome).toMatchObject({ kind: 'written', path: paths.collisionPath });
    expect(await read(paths.path)).toBe(unreadable);
  });

  it.each([
    ['stamped error', 'atlas_import_outcome: error\n'],
    ['stamped duplicate', 'atlas_import_outcome: duplicate\n'],
  ])('does not count a copy %s as holding the meeting', async (_, stamp) => {
    await run();
    const sync = `${MEETINGS}/2026-10-06 Platform weekly sync.md`;
    const text = await read(sync);
    await mkdir(join(vault, 'Archive'));
    await writeFile(
      join(vault, 'Archive/Platform weekly sync.md'),
      text.replace(/^(atlas_import: .*\n)/m, `$1${stamp}`),
    );
    await rm(join(vault, sync));

    const [outcome] = await run();

    expect(outcome).toMatchObject({ kind: 'written', path: sync });
  });

  it('does not count a sync conflict’s copy as holding the meeting', async () => {
    await run();
    const sync = `${MEETINGS}/2026-10-06 Platform weekly sync.md`;
    const conflict = `${MEETINGS}/2026-10-06 Platform weekly sync (conflict from Studio).md`;
    await rename(join(vault, sync), join(vault, conflict));

    const [outcome] = await run();

    expect(outcome).toMatchObject({ kind: 'written', path: sync });
  });

  it('finds a meeting the vault holds before reading the row’s Date, so a Date it cannot read is no matter', async () => {
    await run();
    await rewriteCsv([
      'Platform weekly sync,,Standup,Mara Quill,someday soon,gemini,18c2f4a9e7b3d501',
    ]);

    const [outcome] = await run();

    expect(outcome).toMatchObject({
      kind: 'in-vault',
      path: `${MEETINGS}/2026-10-06 Platform weekly sync.md`,
    });
  });
});

describe('where the import may write', () => {
  it('refuses a vault that does not exist, creating nothing', async () => {
    const missing = join(root, 'no such vault');

    await expect(run({ vault: missing })).rejects.toThrow(ImportSetupError);
    await expect(readdir(missing)).rejects.toThrow(/ENOENT/);
  });

  it.each(['../outside', '/tmp/elsewhere'])(
    'refuses a folder outside the vault: %s',
    async (folder) => {
      await expect(run({ folder })).rejects.toThrow(/is not a folder inside the vault/);
      expect(await readdir(root)).toEqual(['export', 'vault copy']);
    },
  );

  it.each(['.imported', 'Meetings/.from-notion'])(
    'refuses a hidden folder, which Atlas and the next run would not look in: %s',
    async (folder) => {
      await expect(run({ folder })).rejects.toThrow(/is hidden/);
      expect(await readdir(vault)).toEqual([]);
    },
  );

  it.each([
    ['vault', ''],
    ['folder', '  '],
  ])('refuses an empty %s rather than read it as here', async (key) => {
    await expect(run({ [key]: key === 'vault' ? '' : '  ' })).rejects.toThrow(ImportSetupError);
    expect(await readdir(vault)).toEqual([]);
  });

  it('writes into a folder linked to another place inside the vault', async () => {
    await mkdir(join(vault, 'Meetings'));
    await symlink(join(vault, 'Meetings'), join(vault, 'Inbox'));

    await run();

    expect(await readdir(join(vault, 'Meetings/Meetings'))).toHaveLength(4);
  });

  it('refuses a page that is not UTF-8 text, naming it', async () => {
    await addPage('Broken 0000000000000000000000000000bbbb.md', Buffer.from([0x23, 0x20, 0xe9]));

    await expect(run()).rejects.toThrow(/Broken 0+b{4}\.md is not UTF-8 text/);
  });

  it('writes into the folder it is given', async () => {
    await run({ folder: 'Meetings/From Notion' });

    expect(await readdir(join(vault, 'Meetings/From Notion'))).toHaveLength(4);
  });

  it('refuses a CSV that is not the Meeting Notes database', async () => {
    await writeFile(join(exportDir, CSV_NAME), 'Name,Status\nShip it,Done\n');

    await expect(run()).rejects.toThrow(NotionExportError);
    await expect(readdir(join(vault, MEETINGS))).rejects.toThrow(/ENOENT/);
  });
});

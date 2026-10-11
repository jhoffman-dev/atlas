import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importNotionMeetings, type ImportOptions } from './import-notion-meetings.ts';
import { notionWhen } from './notion-date.ts';
import { pageSections } from './notion-page.ts';
import { mapMeeting } from '../../packages/domain/src/meetings/mapping/meeting-to-atlas.ts';

/*
 * Adversarial cases for the Notion import (issue #13, P28-07). Each test names
 * one promise the import makes — "nothing in the page is dropped", "it never
 * writes into a vault it was not given", "a second run writes nothing" — and
 * an input that breaks it. Every name in them is made up.
 */

const CLI = fileURLToPath(new URL('../import-notion-meetings.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('fixtures/export/', import.meta.url));
const CSV_NAME = 'Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54_all.csv';

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-import-attack-')));
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
  folder: 'Inbox/Meetings',
  timeZone: 'America/Los_Angeles',
  groupAddresses: [],
  // The fixture's Platform weekly sync is Gemini's, held without this (issue #44).
  geminiDates: 'arrival-local',
  ...overrides,
});

/** Every file under `folder`, hidden ones included, vault-relative. */
async function allFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('a page’s content all arrives', () => {
  it('keeps a ## Transcript section when a bullet elsewhere on the page reads "Transcript"', () => {
    const body = [
      '## Next steps',
      '',
      '- \\[Mara Quill\\] Share the recording with support.',
      '- Transcript',
      '',
      '## Transcript',
      '',
      'Mara Quill: Morning. Shall we start with the cache?',
      'Tobias Fenn: Yes. It is ready.',
    ].join('\n');

    const sections = pageSections(body);

    expect(Object.values(sections).join('\n')).toContain('Shall we start with the cache?');
  });
});

describe('a Date range carries one zone', () => {
  // A zone written once applies to the range: the start and the end are on one clock.
  it.each([
    ['October 6, 2026 5:00 PM → 5:30 PM (UTC)'],
    ['October 6, 2026 5:00 PM (UTC) → 5:30 PM'],
  ])('reads both sides of %s on the same clock', (cell) => {
    const when = notionWhen(cell);
    const meeting = mapMeeting(
      { title: 'Retro', date: when.date, end: when.end, source: 'gemini', sourceId: 'a1' },
      { timeZone: 'America/Los_Angeles' },
    );

    expect(meeting.content).toMatch(/^start: '10:00'$/m);
    expect(meeting.content).toMatch(/^end: '10:30'$/m);
  });
});

describe('where the import may write', () => {
  it('writes nothing outside the vault through a symlinked folder', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(vault, 'Inbox'));

    await importNotionMeetings(options()).catch(() => null);

    expect(await allFiles(outside)).toEqual([]);
  });

  it('never writes one meeting into the vault twice, even after a run into a hidden folder', async () => {
    // A hidden folder is now refused; whatever the first run does, the meeting is in the vault once.
    await importNotionMeetings(options({ folder: '.imported/Meetings' })).catch(() => null);
    await importNotionMeetings(options({ folder: 'Inbox/Meetings' }));

    const holders: string[] = [];
    for (const path of await allFiles(vault)) {
      if ((await readFile(path, 'utf8')).includes("external_id: '18c2f4a9e7b3d501'")) {
        holders.push(path);
      }
    }
    expect(holders).toHaveLength(1);
  });
});

describe('what the import reads', () => {
  it('does not write a title it could not decode: a CSV re-saved as Windows-1252', async () => {
    const header = 'Meeting name,Date,Source,Source ID\r\n';
    const row = Buffer.concat([
      Buffer.from('Caf'),
      Buffer.from([0xe9]), // é in Windows-1252, not UTF-8
      Buffer.from(' planning,"October 6, 2026 10:00 AM",gemini,18c2f4a9e7b3d501\r\n'),
    ]);
    await writeFile(join(exportDir, CSV_NAME), Buffer.concat([Buffer.from(header), row]));

    const outcomes = await importNotionMeetings(options()).catch(() => []);

    for (const outcome of outcomes) {
      if (outcome.kind !== 'written') continue;
      expect(await readFile(join(vault, outcome.path), 'utf8')).not.toContain('�');
    }
  });
});

// The command starts `node`, which transpiles the domain and the adapters as it loads them: slow under load.
describe('the command', { timeout: 120_000 }, () => {
  it('writes nowhere when --vault is empty, as an unset shell variable leaves it', async () => {
    const here = join(root, 'Atlas Vault');
    await mkdir(here);

    const result = spawnSync(
      process.execPath,
      [CLI, '--csv', join(exportDir, CSV_NAME), '--vault', ''],
      { cwd: here, encoding: 'utf8', timeout: 60_000 },
    );

    expect(await readdir(here)).toEqual([]);
    expect(result.status).toBe(2);
  });
});

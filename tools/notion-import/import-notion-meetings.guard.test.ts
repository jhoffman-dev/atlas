import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Mapper from '../../packages/domain/src/meetings/mapping/meeting-to-atlas.ts';

/*
 * The importer checks each mapped file with Atlas's validator before writing
 * it. The mapping is built never to write a file Atlas refuses, so here it is
 * made to, for one meeting, to show the check stops that file and no other.
 */

const BROKEN_ID = '18c3a0b6d2e4f710';

vi.mock(
  '../../packages/domain/src/meetings/mapping/meeting-to-atlas.ts',
  async (importOriginal) => {
    const original = await importOriginal<typeof Mapper>();
    return {
      ...original,
      mapMeeting: (...args: Parameters<typeof original.mapMeeting>) => {
        const file = original.mapMeeting(...args);
        if (file.externalId !== BROKEN_ID) return file;
        return { ...file, content: file.content.replace(/^title: .*$/m, "title: ''") };
      },
    };
  },
);

const { importNotionMeetings } = await import('./import-notion-meetings.ts');

const FIXTURE = fileURLToPath(new URL('fixtures/export/', import.meta.url));
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-import-guard-')));
  await cp(FIXTURE, join(root, 'export'), { recursive: true });
  await mkdir(join(root, 'vault'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('refuses a file Atlas would not let in, naming the problem, and writes the others', async () => {
  const outcomes = await importNotionMeetings({
    csv: join(root, 'export/Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54_all.csv'),
    vault: join(root, 'vault'),
    folder: 'Inbox/Meetings',
    timeZone: 'America/Los_Angeles',
    groupAddresses: [],
    geminiDates: 'arrival-local',
  });

  expect(outcomes[2]).toMatchObject({
    kind: 'refused',
    row: { title: '1:1', date: '2026-10-02T09:00:00.000Z' },
    reason: expect.stringMatching(/^title: /),
  });
  expect(outcomes.map((outcome) => outcome.kind)).toEqual([
    'written',
    'written',
    'refused',
    'written',
    'no-source-id',
  ]);
  const folder = join(root, 'vault/Inbox/Meetings');
  const texts = await Promise.all(
    (await readdir(folder)).map((name) => readFile(join(folder, name), 'utf8')),
  );
  expect(texts).toHaveLength(3);
  expect(texts.join('\n')).not.toContain(BROKEN_ID);
});

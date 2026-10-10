import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importNotionWorkspace } from './import-notion-workspace.ts';
import { parseRecord, RECORD_PATH } from './import-record.ts';
import { GTD_STATUSES } from './task-status.ts';
import type * as workspaceWrite from './workspace-write.ts';

/*
 * A run cut off between two saves of the record (round-2 adversarial, PR #88):
 * the process dies right after writing the 26th note, one past a save. Every
 * name in the export is made up.
 */

const cutOff = { after: 0, writes: 0 };

vi.mock('./workspace-write.ts', async (original) => {
  const real = await original<typeof workspaceWrite>();
  return {
    ...real,
    writePlanned: vi.fn(async (...args: Parameters<typeof real.writePlanned>) => {
      const result = await real.writePlanned(...args);
      cutOff.writes += 1;
      if (cutOff.after !== 0 && cutOff.writes === cutOff.after) throw new Error('the power went');
      return result;
    }),
  };
});

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));
const TASKS = 'Private & Shared/Tasks Tracker a1000000000000000000000000000000';

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-crash-')));
  exportDir = join(root, 'export');
  vault = join(root, 'vault copy');
  await cp(FIXTURE, exportDir, { recursive: true });
  await mkdir(join(vault, '.atlas', 'types'), { recursive: true });
  await writeFile(
    join(vault, '.atlas', 'types', 'task.md'),
    `---\nname: task\nlabel: Task\nproperties:\n  status:\n    kind: select\n    options: [${GTD_STATUSES.join(', ')}]\n    done: archive\n---\n`,
  );
  // Thirty more tasks, so the run saves its record partway through.
  for (let at = 10; at < 40; at += 1) {
    const title = `Chore ${at}`;
    await appendFile(join(exportDir, `${TASKS}_all.csv`), `${title},Inbox,,,,,,,,,\n`);
    await writeFile(
      join(exportDir, TASKS, `${title} a10000000000000000000000000000${at}.md`),
      `# ${title}\n\nStatus: Inbox\n`,
    );
  }
});

afterEach(async () => {
  cutOff.after = 0;
  cutOff.writes = 0;
  await rm(root, { recursive: true, force: true });
});

const run = () =>
  importNotionWorkspace({
    exportDir,
    vault,
    dryRun: false,
    only: ['tasks'],
    taskStatuses: [],
    today: '2026-10-10',
    timeZone: 'America/Los_Angeles',
  });

async function taskNotes(): Promise<string[]> {
  const entries = await readdir(join(vault, 'Tasks'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => relative(vault, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

describe('a run cut off one note past a save of the record', () => {
  it('leaves the note written after the save deleted when it is deleted in Atlas before the next run', async () => {
    cutOff.after = 26;
    await expect(run()).rejects.toThrow('the power went');
    cutOff.after = 0;
    const record = parseRecord(await readFile(join(vault, RECORD_PATH), 'utf8'));
    let unrecorded = '';
    for (const path of await taskNotes()) {
      const id = /notion_id: '?([0-9a-f]{32})/.exec(await readFile(join(vault, path), 'utf8'))?.[1];
      if (id !== undefined && !record.has(id)) unrecorded = path;
    }
    expect(unrecorded).not.toBe('');
    await rm(join(vault, unrecorded));
    await run();
    expect(await taskNotes()).not.toContain(unrecorded);
  });
});

import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportSetupError } from './import-target.ts';
import { clearPending, notePending, pendingFile, readPending } from './record-file.ts';

/* The record's write-ahead log, against a real folder. */

const ONE = 'a1000000000000000000000000000001';
const TWO = 'a1000000000000000000000000000002';

let folder: string;
let log: string;

beforeEach(async () => {
  folder = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-pending-')));
  log = pendingFile(join(folder, 'notion-workspace.md'));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("the record's write-ahead log", () => {
  it('sits beside the record, and holds each page put in it and not taken out', async () => {
    expect(log).toBe(join(folder, 'notion-workspace.pending'));
    expect(await readPending(log)).toEqual(new Set());
    await notePending(log, `+${ONE}`);
    await notePending(log, `+${TWO}`);
    await notePending(log, `-${TWO}`);
    expect(await readFile(log, 'utf8')).toBe(`+${ONE}\n+${TWO}\n-${TWO}\n`);
    expect(await readPending(log)).toEqual(new Set([ONE]));
    await clearPending(log);
    expect(await readPending(log)).toEqual(new Set());
  });

  it('is refused, never half read, when a line is not one it writes', async () => {
    await writeFile(log, `+${ONE}\nsomething else\n`);
    await expect(readPending(log)).rejects.toThrow(ImportSetupError);
    await expect(readPending(log)).rejects.toThrow('"something else" is not a page id');
  });
});

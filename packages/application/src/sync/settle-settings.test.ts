import { describe, expect, it } from 'vitest';
import {
  journalText,
  parseShippedPropertiesRecord,
  SHIPPED_PROPERTIES_RECORD_PATH,
  shippedPropertiesRecordText,
  type GitConflict,
} from '@dfai/domain';
import {
  failed,
  fakeBlob,
  memorySyncFiles,
  memoryVault,
  said,
  scriptedGit,
  type GitScript,
} from '../testing/fake-git.ts';
import { fakeMarkdown } from '../testing/fake-ports.ts';
import { settleConflicts } from './settle-conflicts.ts';

const MERGE_HEAD = 'f'.repeat(40);
const RECORD = SHIPPED_PROPERTIES_RECORD_PATH as string;
const NOTHING_LEFT_OUT = { large: [], nested: [] };

const record = (meeting: string[]) =>
  shippedPropertiesRecordText({ settled: { meeting }, added: { meeting } });

/** The record as a Mac on the older build wrote it, and as one on the newer build did. */
const SIDES = {
  base: record(['tasks']),
  ours: record(['tasks', 'decisions']),
  theirs: record(['tasks', 'atlas_summary_of']),
};
const MARKED = `<<<<<<< HEAD\n${SIDES.ours}=======\n${SIDES.theirs}>>>>>>> origin/main\n`;

const conflictOf = (path: string, sides: typeof SIDES): GitConflict => {
  const side = (text: string) => ({ mode: '100644', oid: fakeBlob(text) });
  return {
    path,
    code: 'UU',
    base: side(sides.base),
    ours: side(sides.ours),
    theirs: side(sides.theirs),
  };
};

/** A merge under way that stopped on `path`, journalled, with the file holding `onDisk`. */
function stoppedOn({
  path = RECORD,
  onDisk = MARKED,
  script = {},
}: { path?: string; onDisk?: string; script?: GitScript } = {}) {
  const vault = memoryVault({ [path]: onDisk });
  const c = conflictOf(path, SIDES);
  const { git } = scriptedGit({
    script: { mergeInProgress: said(`${MERGE_HEAD}\n`), ...script },
    vault: vault.files,
    sides: { [path]: SIDES },
  });
  const { port: files } = memorySyncFiles({
    'journal.json': journalText({
      mergeHead: MERGE_HEAD,
      unreported: [],
      files: [
        {
          path,
          merged: fakeBlob(MARKED),
          ours: c.ours!.oid,
          theirs: c.theirs!.oid,
          copy: null,
        },
      ],
    }),
  });
  const settle = () =>
    settleConflicts({
      git,
      files,
      conflicts: [c],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
      settings: { vault: vault.fs, markdown: fakeMarkdown() },
    });
  return { settle, vault };
}

describe('settleConflicts on a settings file of DFAI’s own (#233)', () => {
  it('writes the record both Macs changed as the union of both, with no copy', async () => {
    const { settle, vault } = stoppedOn();
    expect(await settle()).toEqual([]);
    const merged = parseShippedPropertiesRecord(vault.files.get(RECORD) ?? '');
    expect(merged.settled['meeting']).toEqual(['atlas_summary_of', 'decisions', 'tasks']);
    expect([...vault.files.keys()]).toEqual([RECORD]);
  });

  it('keeps typing put into the file since the merge, and copies the other Mac’s instead', async () => {
    const typed = `${MARKED}my own words\n`;
    const { settle, vault } = stoppedOn({ onDisk: typed });
    const copies = await settle();
    expect(copies).toHaveLength(1);
    expect(vault.files.get(RECORD)).toBe(typed);
  });

  it('after a quit, leaves a merge it already wrote as it is, and makes no copy', async () => {
    const { settle: first, vault } = stoppedOn();
    await first();
    const written = vault.files.get(RECORD);
    const { settle: again, vault: after } = stoppedOn({ onDisk: written ?? '' });
    expect(await again()).toEqual([]);
    expect(after.files.get(RECORD)).toBe(written);
  });

  it.each([
    ['git fails to read a side', { readBlob: failed('fatal: bad object', 128) }],
    [
      'the host cut a side short',
      { readBlob: { code: 0, stdout: SIDES.theirs, stderr: 'DFAI cut cat-file’s output.' } },
    ],
    ['a side is not UTF-8', { readBlob: said(`${SIDES.theirs}\uFFFD\n`) }],
  ])('keeps both versions, with a copy, when %s', async (_, script) => {
    const { settle, vault } = stoppedOn({ script });
    expect(await settle()).toHaveLength(1);
    // As for any file both Macs changed: this Mac's version stays, the other's is the copy.
    expect(vault.files.get(RECORD)).toBe(SIDES.ours);
  });

  it('leaves a note outside `.atlas` to the copy, whatever it holds', async () => {
    const { settle } = stoppedOn({ path: 'Notes/type-properties.md' });
    expect(await settle()).toHaveLength(1);
  });
});

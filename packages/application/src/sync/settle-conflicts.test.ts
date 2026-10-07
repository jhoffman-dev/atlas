import { describe, expect, it } from 'vitest';
import { journalText, type GitConflict } from '@atlas/domain';
import { fakeBlob, memorySyncFiles, said, scriptedGit } from '../testing/fake-git.ts';
import { mergeHeadOf, recordMerge, settleConflicts } from './settle-conflicts.ts';

const MERGE_HEAD = 'f'.repeat(40);

/** The journal a sync writes before settling: the copy's name planned for this conflict. */
function planned(c: GitConflict, marked: string, copy = 'Ideas (conflict from Laptop).md') {
  return journalText({
    mergeHead: MERGE_HEAD,
    unreported: [{ path: c.path, copy, whose: 'theirs' }],
    files: [
      {
        path: c.path,
        merged: fakeBlob(marked),
        ours: c.ours?.oid ?? null,
        theirs: c.theirs?.oid ?? null,
        copy,
      },
    ],
  });
}

/** A conflict as `settleConflicts` sees it: sides given a real blob for their text, or none at all. */
function conflict(
  path: string,
  code: GitConflict['code'],
  sides: { base?: string; ours?: string; theirs?: string },
): GitConflict {
  const side = (text: string | undefined) =>
    text === undefined ? null : { mode: '100644', oid: fakeBlob(text) };
  return { path, code, base: side(sides.base), ours: side(sides.ours), theirs: side(sides.theirs) };
}

describe('mergeHeadOf', () => {
  it('is null with no merge under way, and the commit while one is', async () => {
    const { git: idle } = scriptedGit();
    await expect(mergeHeadOf(idle)).resolves.toBeNull();
    const { git: merging } = scriptedGit({ script: { mergeInProgress: said(`${MERGE_HEAD}\n`) } });
    await expect(mergeHeadOf(merging)).resolves.toBe(MERGE_HEAD);
  });
});

describe('recordMerge', () => {
  it('writes nothing without a merge under way', async () => {
    const { git } = scriptedGit();
    const { port: files, files: written } = memorySyncFiles();
    await recordMerge({ git, files, conflicts: [conflict('Ideas.md', 'UU', {})] });
    expect(written.has('journal.json')).toBe(false);
  });

  it('journals what git wrote into each conflicted file, before anything else can touch it', async () => {
    const marked = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n';
    const { git } = scriptedGit({
      script: { mergeInProgress: said(`${MERGE_HEAD}\n`) },
      vault: new Map([['Ideas.md', marked]]),
    });
    const c = conflict('Ideas.md', 'UU', { ours: 'mine\n', theirs: 'theirs\n' });
    const { port: files, files: written } = memorySyncFiles();
    await recordMerge({ git, files, conflicts: [c] });
    expect(JSON.parse(written.get('journal.json') ?? '')).toMatchObject({
      mergeHead: MERGE_HEAD,
      files: [
        {
          path: 'Ideas.md',
          merged: fakeBlob(marked),
          ours: c.ours?.oid,
          theirs: c.theirs?.oid,
          copy: null,
        },
      ],
    });
  });

  it('journals no merged blob for a file git left with nothing written', async () => {
    const { git } = scriptedGit({ script: { mergeInProgress: said(`${MERGE_HEAD}\n`) } });
    const { port: files, files: written } = memorySyncFiles();
    await recordMerge({ git, files, conflicts: [conflict('Gone.md', 'DD', {})] });
    expect(JSON.parse(written.get('journal.json') ?? '')).toMatchObject({
      files: [{ path: 'Gone.md', merged: null }],
    });
  });
});

describe('settleConflicts', () => {
  const NOTHING_LEFT_OUT = { large: [], nested: [] };

  it('picks a fresh copy name and journals it, with no journal to start from', async () => {
    const marked = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n';
    const sides = { ours: 'mine\n', theirs: 'theirs\n' };
    const c = conflict('Ideas.md', 'UU', sides);
    const { git } = scriptedGit({
      vault: new Map([['Ideas.md', marked]]),
      sides: { 'Ideas.md': sides },
    });
    const { port: files, files: written } = memorySyncFiles();
    const copies = await settleConflicts({
      git,
      files,
      conflicts: [c],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(copies).toEqual([
      { path: 'Ideas.md', copy: 'Ideas (conflict from Laptop).md', whose: 'theirs' },
    ]);
    expect(JSON.parse(written.get('journal.json') ?? '')).toMatchObject({
      files: [{ path: 'Ideas.md', copy: 'Ideas (conflict from Laptop).md' }],
    });
  });

  it('reuses the copy name a journal already planned, rather than picking again', async () => {
    const marked = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n';
    const sides = { ours: 'mine\n', theirs: 'theirs\n' };
    const c = conflict('Ideas.md', 'UU', sides);
    const journal = journalText({
      mergeHead: MERGE_HEAD,
      unreported: [],
      files: [
        {
          path: 'Ideas.md',
          merged: fakeBlob(marked),
          ours: c.ours?.oid ?? null,
          theirs: c.theirs?.oid ?? null,
          copy: 'Ideas (already planned).md',
        },
      ],
    });
    const { git } = scriptedGit({
      script: { mergeInProgress: said(`${MERGE_HEAD}\n`) },
      vault: new Map([['Ideas.md', marked]]),
      sides: { 'Ideas.md': sides },
    });
    const { port: files } = memorySyncFiles({ 'journal.json': journal });
    const copies = await settleConflicts({
      git,
      files,
      conflicts: [c],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(copies).toEqual([
      { path: 'Ideas.md', copy: 'Ideas (already planned).md', whose: 'theirs' },
    ]);
  });

  it('keeps typing done into the file since the merge stopped, the journal telling it apart from the markers', async () => {
    const marked = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n';
    const typed = 'typed after the merge stopped\n';
    const sides = { ours: 'mine\n', theirs: 'theirs\n' };
    const c = conflict('Ideas.md', 'UU', sides);
    const journal = journalText({
      mergeHead: MERGE_HEAD,
      unreported: [],
      files: [
        {
          path: 'Ideas.md',
          merged: fakeBlob(marked),
          ours: c.ours?.oid ?? null,
          theirs: c.theirs?.oid ?? null,
          copy: null,
        },
      ],
    });
    const vault = new Map([['Ideas.md', typed]]);
    const { git } = scriptedGit({
      script: { mergeInProgress: said(`${MERGE_HEAD}\n`) },
      vault,
      sides: { 'Ideas.md': sides },
    });
    const { port: files } = memorySyncFiles({ 'journal.json': journal });
    await settleConflicts({ git, files, conflicts: [c], mac: 'Laptop', leftOut: NOTHING_LEFT_OUT });
    // No `checkout` writes this Mac's side back over what was typed since.
    expect(vault.get('Ideas.md')).toBe(typed);
  });

  it('leaves the copy as it is when it was already written before a quit', async () => {
    const marked = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n';
    const sides = { ours: 'mine\n', theirs: 'theirs\n' };
    const c = conflict('Ideas.md', 'UU', sides);
    const vault = new Map([
      ['Ideas.md', marked],
      // The copy already holds exactly the other side's text.
      ['Ideas (conflict from Laptop).md', sides.theirs],
    ]);
    const { git, called } = scriptedGit({
      script: { mergeInProgress: said(`${MERGE_HEAD}\n`) },
      vault,
      sides: { 'Ideas.md': sides },
    });
    const { port: files } = memorySyncFiles({ 'journal.json': planned(c, marked) });
    const copies = await settleConflicts({
      git,
      files,
      conflicts: [c],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(copies).toEqual([
      { path: 'Ideas.md', copy: 'Ideas (conflict from Laptop).md', whose: 'theirs' },
    ]);
    // writeFromIndex refused (the file is already there) — but it already held theirs, so nothing failed.
    expect(called('writeFromIndex')).toHaveLength(1);
  });

  // Review A29-01 [L4]: a copy the person edited after a quit is theirs now,
  // and is kept; the other Mac's version goes to a new name, where every sync
  // after used to stop on "save the other Mac's version".
  it('keeps a copy the person edited after a quit, and saves the other Mac’s version to a new name', async () => {
    const marked = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n';
    const sides = { ours: 'mine\n', theirs: 'theirs\n' };
    const c = conflict('Ideas.md', 'UU', sides);
    const vault = new Map([
      ['Ideas.md', marked],
      // The copy is there, but holds neither side's text.
      ['Ideas (conflict from Laptop).md', 'something else entirely'],
    ]);
    const { git } = scriptedGit({
      script: { mergeInProgress: said(`${MERGE_HEAD}\n`) },
      vault,
      sides: { 'Ideas.md': sides },
    });
    const { port: files, files: written } = memorySyncFiles({
      'journal.json': planned(c, marked),
    });
    const copies = await settleConflicts({
      git,
      files,
      conflicts: [c],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(copies).toEqual([
      { path: 'Ideas.md', copy: 'Ideas (conflict from Laptop) 2.md', whose: 'theirs' },
    ]);
    expect(vault.get('Ideas (conflict from Laptop).md')).toBe('something else entirely');
    expect(vault.get('Ideas (conflict from Laptop) 2.md')).toBe(sides.theirs);
    expect(JSON.parse(written.get('journal.json') ?? '')).toMatchObject({
      files: [{ path: 'Ideas.md', copy: 'Ideas (conflict from Laptop) 2.md' }],
    });
  });

  it('settles a file both Macs deleted by untracking it', async () => {
    const { git, called } = scriptedGit();
    const { port: files } = memorySyncFiles();
    const copies = await settleConflicts({
      git,
      files,
      conflicts: [conflict('Gone.md', 'DD', {})],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(copies).toEqual([]);
    expect(called('untrack').map(({ args }) => args)).toEqual(['Gone.md']);
  });

  it('keeps the other Mac’s file when this Mac deleted it', async () => {
    const { git, called } = scriptedGit();
    const { port: files } = memorySyncFiles();
    const copies = await settleConflicts({
      git,
      files,
      conflicts: [conflict('Edited there.md', 'DU', { theirs: 'theirs' })],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(copies).toEqual([]);
    expect(called('checkout').map(({ args }) => args)).toEqual([
      { side: 'theirs', path: 'Edited there.md' },
    ]);
  });

  it('does not overwrite a file this Mac made again after deleting it', async () => {
    const { git, called } = scriptedGit({ vault: new Map([['Back again.md', 'made again']]) });
    const { port: files } = memorySyncFiles();
    await settleConflicts({
      git,
      files,
      conflicts: [conflict('Back again.md', 'DU', { theirs: 'theirs' })],
      mac: 'Laptop',
      leftOut: NOTHING_LEFT_OUT,
    });
    expect(called('checkout')).toHaveLength(0);
  });
});

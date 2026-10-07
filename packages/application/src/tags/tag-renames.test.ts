/**
 * Tag renames in one vault, one at a time (A20-04): the tags page and the API
 * share the queue, so two renames never plan against each other's old vault,
 * and whether a rename merges is asked again just before it writes — counting
 * the names earlier renames wrote that the index has not caught up with.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { tagIndexQuery } from '../testing/tag-index.ts';
import { createTagRenames, TagMergeError } from './tag-renames.ts';

const markdown = fakeMarkdown();

/** A vault whose index, like the app's, still shows the files as they were at first. */
function vault(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const writes: string[] = [];
  const fs = fakeVaultFs({
    readNotes: async (paths) =>
      paths.map((path) => ({ path, text: disk.get(path) ?? '', modified: 1, size: 1 })),
    readTextFile: async (path) => ({ text: disk.get(path) ?? '', modified: 1 }),
    writeTextFile: vi.fn(async ({ path, contents }: { path: string; contents: string }) => {
      writes.push(path);
      disk.set(path, contents);
      return 2;
    }),
  });
  const index = fakeIndexPort({ query: tagIndexQuery({ files, markdown }) });
  return { fs, disk, writes, index, markdown };
}

const closed = () => ({ state: () => 'closed' as const, flush: async () => {}, reload: () => {} });

const TWO = { 'a.md': 'Uses #idea.\n', 'b.md': 'Uses #thought.\n' };

describe('renaming tags through the queue', () => {
  it('refuses, at the moment of writing, a merge an earlier rename made, unless merging was agreed', async () => {
    const ports = vault(TWO);
    const renames = createTagRenames().forVault('/v');
    // Both planned before either wrote: neither plan sees the other's `#concept`.
    const first = await renames.plan({ ...ports, rename: { from: 'idea', to: 'concept' } });
    const second = await renames.plan({ ...ports, rename: { from: 'thought', to: 'concept' } });
    expect(second.mergesInto).toBeNull();

    const answers = await Promise.allSettled([
      renames.rename({ ...ports, openNotes: closed(), plan: first, merge: false }),
      renames.rename({ ...ports, openNotes: closed(), plan: second, merge: false }),
    ]);

    expect(answers[0]).toMatchObject({ status: 'fulfilled' });
    expect(answers[1]).toMatchObject({ status: 'rejected', reason: expect.any(TagMergeError) });
    expect(ports.disk.get('b.md')).toBe('Uses #thought.\n');
  });

  it('merges when the caller agreed to it', async () => {
    const ports = vault(TWO);
    const renames = createTagRenames().forVault('/v');
    const first = await renames.plan({ ...ports, rename: { from: 'idea', to: 'concept' } });
    const second = await renames.plan({ ...ports, rename: { from: 'thought', to: 'concept' } });
    await renames.rename({ ...ports, openNotes: closed(), plan: first, merge: false });
    await renames.rename({ ...ports, openNotes: closed(), plan: second, merge: true });
    expect(ports.disk.get('b.md')).toBe('Uses #concept.\n');
  });

  it('refuses, at the moment of writing, a merge into a tag only an archived note uses', async () => {
    const ports = vault({ 'a.md': 'Uses #idea.\n' });
    const renames = createTagRenames().forVault('/v');
    const plan = await renames.plan({ ...ports, rename: { from: 'idea', to: 'concept' } });
    expect(plan.mergesInto).toBeNull();
    // Meanwhile a note using #concept was archived: unarchived, it would join the renamed notes.
    const later = vault({ 'a.md': 'Uses #idea.\n', 'Archive/b.md': 'Uses #concept.\n' });

    const answer = renames.rename({
      ...ports,
      index: later.index,
      openNotes: closed(),
      plan,
      merge: false,
    });

    await expect(answer).rejects.toBeInstanceOf(TagMergeError);
    expect(ports.writes).toEqual([]);
  });

  it('plans a merge into a name an earlier rename wrote, before the index shows it', async () => {
    const ports = vault(TWO);
    const renames = createTagRenames().forVault('/v');
    const first = await renames.plan({ ...ports, rename: { from: 'idea', to: 'Concept' } });
    await renames.rename({ ...ports, openNotes: closed(), plan: first, merge: false });

    const second = await renames.plan({ ...ports, rename: { from: 'thought', to: 'concept' } });

    expect(second.mergesInto).toBe('Concept');
  });

  it('writes one rename only once the one before it has finished', async () => {
    const ports = vault(TWO);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = {
      ...ports,
      fs: {
        ...ports.fs,
        writeTextFile: async (write: Parameters<typeof ports.fs.writeTextFile>[0]) => {
          await held;
          return ports.fs.writeTextFile(write);
        },
      },
    };
    const renames = createTagRenames().forVault('/v');
    const first = await renames.plan({ ...ports, rename: { from: 'idea', to: 'concept' } });
    const second = await renames.plan({ ...ports, rename: { from: 'thought', to: 'other' } });

    const done = [
      renames.rename({ ...slow, openNotes: closed(), plan: first, merge: false }),
      renames.rename({ ...ports, openNotes: closed(), plan: second, merge: false }),
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ports.writes).toEqual([]);

    release();
    await Promise.all(done);
    expect(ports.writes).toEqual(['a.md', 'b.md']);
  });

  it('carries on with the next rename after one fails', async () => {
    const ports = vault(TWO);
    const renames = createTagRenames().forVault('/v');
    const first = await renames.plan({ ...ports, rename: { from: 'idea', to: 'concept' } });
    const failing = {
      ...ports,
      index: fakeIndexPort({ query: () => Promise.reject(new Error('gone')) }),
    };
    const second = await renames.plan({ ...ports, rename: { from: 'thought', to: 'other' } });

    await expect(
      renames.rename({ ...failing, openNotes: closed(), plan: first, merge: false }),
    ).rejects.toThrow('gone');
    await renames.rename({ ...ports, openNotes: closed(), plan: second, merge: false });

    expect(ports.disk.get('b.md')).toBe('Uses #other.\n');
  });

  it('keeps what one vault’s renames wrote out of another’s', async () => {
    const renames = createTagRenames();
    const one = vault(TWO);
    const first = await renames
      .forVault('/one')
      .plan({ ...one, rename: { from: 'idea', to: 'concept' } });
    await renames
      .forVault('/one')
      .rename({ ...one, openNotes: closed(), plan: first, merge: false });

    const other = vault(TWO);
    const plan = await renames
      .forVault('/other')
      .plan({ ...other, rename: { from: 'thought', to: 'concept' } });

    expect(plan.mergesInto).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { fixtureVault, FIXTURE_SHAPE, noteCount } from './fixture-vault.ts';

describe('the fixture vault (#217)', () => {
  const files = fixtureVault();
  const notes = files.filter((file) => !file.path.startsWith('.atlas/'));

  it('holds 2,000 notes, 637 of them waiting in the Inbox', () => {
    expect(noteCount(FIXTURE_SHAPE)).toBe(2000);
    expect(notes).toHaveLength(2000);
    expect(notes.filter((file) => file.path.startsWith('Inbox/'))).toHaveLength(637);
  });

  it('never names one path twice', () => {
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
  });

  it('is the same, byte for byte, from one run to the next', () => {
    expect(fixtureVault()).toEqual(files);
    expect(fixtureVault(FIXTURE_SHAPE, 218)).not.toEqual(files);
  });

  it('files its tasks under projects it holds, as links a vault would write', () => {
    const projects = new Set(
      notes
        .filter((file) => file.path.startsWith('Projects/'))
        .map((file) => file.path.replace(/\.md$/, '')),
    );
    const linked = notes
      .filter((file) => file.path.startsWith('Tasks/'))
      .map((file) => /^project: "\[\[(.+)\]\]"$/m.exec(file.contents)?.[1]);
    expect(linked.every((target) => target !== undefined && projects.has(target))).toBe(true);
  });
});

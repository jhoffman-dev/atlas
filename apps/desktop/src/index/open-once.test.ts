import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeIndexPort } from '@atlas/application';
import { openOnce } from './open-once.ts';

/** An index that counts its openings, and fails the calls a test says to. */
function countedIndex() {
  const opened = { count: 0 };
  const failing = { open: false, put: false };
  const index = fakeIndexPort({
    open: async () => {
      opened.count += 1;
      if (failing.open) throw new Error('the database is locked');
      return { fresh: opened.count === 1 };
    },
    put: async () => {
      if (failing.put) throw new Error('the index went away');
    },
  });
  return { index, opened, failing };
}

describe('openOnce (#238)', () => {
  it('opens the index once, and hands every later caller the same opening', async () => {
    const { index, opened } = countedIndex();
    const once = openOnce(index);
    const [first, second] = await Promise.all([once.open(), once.open()]);
    expect(await once.open()).toEqual({ fresh: true });
    expect(first).toBe(second);
    expect(opened.count).toBe(1);
  });

  it('opens it again after an opening that failed', async () => {
    const { index, opened, failing } = countedIndex();
    const once = openOnce(index);
    failing.open = true;
    await expect(once.open()).rejects.toThrow('the database is locked');
    failing.open = false;
    await expect(once.open()).resolves.toEqual({ fresh: false });
    expect(opened.count).toBe(2);
  });

  it('opens it again after a call a sync makes has failed, and passes the failure on', async () => {
    const { index, opened, failing } = countedIndex();
    const once = openOnce(index);
    await once.open();
    failing.put = true;
    await expect(once.put([])).rejects.toThrow('the index went away');
    await once.open();
    expect(opened.count).toBe(2);
  });

  it('keeps its opening across a clear, which the host reopens after by itself', async () => {
    const { index, opened } = countedIndex();
    const once = openOnce(index);
    await once.open();
    await once.clear();
    await once.open();
    expect(opened.count).toBe(1);
  });

  it('passes every other call straight through', async () => {
    const { index } = countedIndex();
    const once = openOnce({ ...index, backlinks: async () => ['Mara Quill.md'] });
    expect(await once.backlinks(createVaultPath('Tobias Fenn.md'))).toEqual(['Mara Quill.md']);
  });
});

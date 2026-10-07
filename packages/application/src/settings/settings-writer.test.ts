import { describe, expect, it } from 'vitest';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { jsonMarkdown } from '../testing/settings-vault.ts';
import { createSettingsWriter } from './settings-writer.ts';

const PATH = '.atlas/settings.md';

/**
 * A vault that behaves like the host: a write naming a stale modification time
 * is refused, and creating a note that already exists fails.
 */
function hostLikeVault(initial: string | null) {
  const file = { text: initial, modified: 1, creates: 0, writes: 0 };
  const fs = fakeVaultFs({
    readNotes: async () =>
      file.text === null ? [] : [{ path: PATH, text: file.text, modified: file.modified, size: 1 }],
    readTextFile: async () => ({ text: file.text ?? '', modified: file.modified }),
    writeTextFile: async ({ contents, expectedModified }) => {
      if (expectedModified !== null && expectedModified !== file.modified)
        throw new Error('the note changed on disk');
      file.writes += 1;
      file.text = contents;
      file.modified += 1;
      return file.modified;
    },
    createNote: async ({ contents }) => {
      if (file.text !== null) throw new Error('a note with that name already exists');
      file.creates += 1;
      file.text = contents;
    },
  });
  return { fs, file };
}

const read = (text: string | null) =>
  jsonMarkdown().frontmatterProperties(text === null ? null : (text.split('\n# ')[0] ?? null));

describe('createSettingsWriter', () => {
  it('keeps both of two settings saved at the same moment', async () => {
    const { fs, file } = hostLikeVault(
      '---\n{"quickAdd":["task"],"sidebarOrder":["views"]}\n---\n',
    );
    const settings = createSettingsWriter({ fs, markdown: jsonMarkdown() });

    await Promise.all([
      settings.save({ sidebarOrder: ['userSpace', 'views'] }),
      settings.save({ quickAdd: ['task', 'note'] }),
    ]);

    expect(read(file.text)).toEqual({
      quickAdd: ['task', 'note'],
      sidebarOrder: ['userSpace', 'views'],
    });
  });

  it('creates a missing settings note once, and updates it for the next save', async () => {
    const { fs, file } = hostLikeVault(null);
    const settings = createSettingsWriter({ fs, markdown: jsonMarkdown() });

    const first = settings.save({ sidebarOrder: ['views'] });
    // Queued behind the first, so it reads the note the first one made.
    await Promise.resolve();
    const second = settings.save({ quickAdd: ['task'] });
    await Promise.all([first, second]);

    expect(file.creates).toBe(1);
    expect(read(file.text)).toEqual({ sidebarOrder: ['views'], quickAdd: ['task'] });
  });

  it('writes the latest value when one setting is saved twice in a row', async () => {
    const { fs, file } = hostLikeVault('---\n{}\n---\n');
    const settings = createSettingsWriter({ fs, markdown: jsonMarkdown() });

    await Promise.all([
      settings.save({ sidebarOrder: ['views'] }),
      settings.save({ sidebarOrder: ['types', 'views'] }),
    ]);

    expect(read(file.text)).toEqual({ sidebarOrder: ['types', 'views'] });
  });

  it('passes a refused write to its callers, and still writes the next save', async () => {
    const { fs, file } = hostLikeVault('---\n{}\n---\n');
    let refuse = true;
    const flaky = {
      ...fs,
      writeTextFile: (args: Parameters<typeof fs.writeTextFile>[0]) =>
        refuse ? Promise.reject(new Error('read-only')) : fs.writeTextFile(args),
    };
    const settings = createSettingsWriter({ fs: flaky, markdown: jsonMarkdown() });

    await expect(settings.save({ quickAdd: ['task'] })).rejects.toThrow('read-only');
    refuse = false;
    await settings.save({ quickAdd: ['note'] });

    expect(read(file.text)).toEqual({ quickAdd: ['note'] });
  });
});

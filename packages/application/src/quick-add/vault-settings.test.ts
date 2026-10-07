import { describe, expect, it } from 'vitest';
import type { VaultEntry } from '@atlas/domain';
import { createVaultPath } from '@atlas/domain';
import { createSettingsWriter } from '../settings/index.ts';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import { loadQuickAddSetting, saveQuickAddSetting } from './vault-settings.ts';

const PATH = '.atlas/settings.md';

const ATLAS: VaultEntry = {
  kind: 'directory',
  name: '.atlas',
  path: createVaultPath('.atlas'),
};

describe('loadQuickAddSetting', () => {
  it('reads unset when the vault has no settings file', async () => {
    const { fs } = vaultWith({});
    expect(await loadQuickAddSetting({ fs, markdown: jsonMarkdown() })).toBeNull();
  });

  it('reads unset when the file does not mention the add button', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{"theme":"dark"}\n---\n' });
    expect(await loadQuickAddSetting({ fs, markdown: jsonMarkdown() })).toBeNull();
  });

  it('reads the listed types through the domain rules', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{"quickAdd":["project","task","task"]}\n---\n' });
    expect(await loadQuickAddSetting({ fs, markdown: jsonMarkdown() })).toEqual([
      'project',
      'task',
    ]);
  });
});

describe('saveQuickAddSetting', () => {
  it('writes into the existing file, keeping its other settings and its words', async () => {
    const { fs, written, created } = vaultWith({
      [PATH]: '---\n{"theme":"dark"}\n---\n\nMy notes.\n',
    });
    await saveQuickAddSetting({
      settings: createSettingsWriter({ fs, markdown: jsonMarkdown() }),
      types: ['task', 'project'],
    });

    expect(created).toEqual([]);
    expect(written[PATH]).toContain('"theme":"dark"');
    expect(written[PATH]).toContain('"quickAdd":["task","project"]');
    expect(written[PATH]).toContain('My notes.');
  });

  it('makes the file when there is none, in the existing .atlas folder', async () => {
    const { fs, written, created, folders } = vaultWith({}, [ATLAS]);
    await saveQuickAddSetting({
      settings: createSettingsWriter({ fs, markdown: jsonMarkdown() }),
      types: ['task'],
    });

    expect(created).toEqual([PATH]);
    expect(folders).toEqual([]);
    expect(written[PATH]).toContain('"quickAdd":["task"]');
  });

  it('makes .atlas first in a vault that has none', async () => {
    const { fs, created, folders } = vaultWith({});
    await saveQuickAddSetting({
      settings: createSettingsWriter({ fs, markdown: jsonMarkdown() }),
      types: [],
    });

    expect(folders).toEqual(['.atlas']);
    expect(created).toEqual([PATH]);
  });

  it('passes on a write the host refuses', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{}\n---\n' });
    const refusing = { ...fs, writeTextFile: () => Promise.reject(new Error('read-only')) };
    await expect(
      saveQuickAddSetting({
        settings: createSettingsWriter({ fs: refusing, markdown: jsonMarkdown() }),
        types: ['task'],
      }),
    ).rejects.toThrow('read-only');
  });
});

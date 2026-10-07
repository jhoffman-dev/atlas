import { describe, expect, it } from 'vitest';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import { readVaultSettings, saveVaultSettings } from './vault-settings.ts';

const PATH = '.atlas/settings.md';
const BROKEN = '---\n{"quickAdd": ["task"],,}\n---\n\n# Settings\n';

describe('readVaultSettings', () => {
  it('reads nothing from a vault with no settings note', async () => {
    const { fs } = vaultWith({});
    expect(await readVaultSettings({ fs, markdown: jsonMarkdown() })).toEqual({});
  });

  it('names the settings note when its frontmatter cannot be read, rather than reading nothing', async () => {
    const { fs } = vaultWith({ [PATH]: BROKEN });
    await expect(readVaultSettings({ fs, markdown: jsonMarkdown() })).rejects.toThrow(
      '.atlas/settings.md',
    );
  });
});

describe('saveVaultSettings', () => {
  it('leaves a settings note it cannot read as it is', async () => {
    const { fs, written } = vaultWith({ [PATH]: BROKEN });

    await expect(
      saveVaultSettings({ fs, markdown: jsonMarkdown(), changes: { quickAdd: ['note'] } }),
    ).rejects.toThrow('.atlas/settings.md');
    expect(written[PATH]).toBe(BROKEN);
  });
});

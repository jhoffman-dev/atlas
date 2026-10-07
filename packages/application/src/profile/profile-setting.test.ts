import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE } from '@atlas/domain';
import { createSettingsWriter } from '../settings/index.ts';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import { loadProfile, saveProfile } from './profile-setting.ts';

const PATH = '.atlas/settings.md';

describe('loadProfile', () => {
  it('reads an empty profile when the vault has no settings file', async () => {
    const { fs } = vaultWith({});
    expect(await loadProfile({ fs, markdown: jsonMarkdown() })).toEqual({
      name: null,
      preferredName: null,
    });
  });

  it('reads the names through the domain rules', async () => {
    const { fs } = vaultWith({
      [PATH]: '---\n{"profileName":" James  Hoffman ","profilePreferredName":"James"}\n---\n',
    });
    expect(await loadProfile({ fs, markdown: jsonMarkdown() })).toEqual({
      name: 'James Hoffman',
      preferredName: 'James',
    });
  });

  it('refuses a settings note it cannot read, rather than reading no name', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{not json\n---\n' });
    await expect(loadProfile({ fs, markdown: jsonMarkdown() })).rejects.toThrow(PATH);
  });
});

describe('saveProfile', () => {
  it('writes the names into the existing file, keeping its other settings and words', async () => {
    const { fs, written } = vaultWith({ [PATH]: '---\n{"quickAdd":["task"]}\n---\n\nMine.\n' });
    await saveProfile({
      settings: createSettingsWriter({ fs, markdown: jsonMarkdown() }),
      profile: { name: 'James Hoffman', preferredName: null },
      previous: EMPTY_PROFILE,
    });

    expect(written[PATH]).toContain('"quickAdd":["task"]');
    expect(written[PATH]).toContain('"profileName":"James Hoffman"');
    expect(written[PATH]).not.toContain('profilePreferredName');
    expect(written[PATH]).toContain('Mine.');
  });

  it('writes only the name that changed, leaving a hand-written one it cannot show', async () => {
    const { fs, written } = vaultWith({
      [PATH]: '---\n{"profileName":["Ada","Lovelace"]}\n---\n',
    });
    const previous = await loadProfile({ fs, markdown: jsonMarkdown() });
    await saveProfile({
      settings: createSettingsWriter({ fs, markdown: jsonMarkdown() }),
      profile: { ...previous, preferredName: 'Ada' },
      previous,
    });

    expect(written[PATH]).toContain('"profileName":["Ada","Lovelace"]');
    expect(written[PATH]).toContain('"profilePreferredName":"Ada"');
  });

  it('passes on a write the host refuses', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{}\n---\n' });
    const refusing = { ...fs, writeTextFile: () => Promise.reject(new Error('read-only')) };
    await expect(
      saveProfile({
        settings: createSettingsWriter({ fs: refusing, markdown: jsonMarkdown() }),
        profile: { name: 'James Hoffman', preferredName: null },
        previous: EMPTY_PROFILE,
      }),
    ).rejects.toThrow('read-only');
  });
});

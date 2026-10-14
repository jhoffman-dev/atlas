import { describe, expect, it } from 'vitest';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import { loadGranolaSettings } from './granola-settings.ts';

const SETTINGS = '.atlas/settings.md';

describe('loadGranolaSettings', () => {
  it('reads Granola’s settings from the vault’s settings note', async () => {
    const { fs } = vaultWith({
      [SETTINGS]:
        '---\n{"granola_time_zone":"Europe/London","granola_webhook":true,"granola_periodic":false,"granola_group_addresses":["eng@example.com"],"granola_self_emails":["mara.quill@example.com"]}\n---\n',
    });
    expect(await loadGranolaSettings({ fs, markdown: jsonMarkdown() })).toEqual({
      timeZone: 'Europe/London',
      webhook: true,
      periodic: false,
      groupAddresses: ['eng@example.com'],
      selfEmails: ['mara.quill@example.com'],
    });
  });

  it('takes the person’s own addresses from the setting alone, not the profile’s Person note', async () => {
    const { fs } = vaultWith({
      [SETTINGS]: '---\n{"profileName":"Mara Quill"}\n---\n',
      'People/Mara Quill.md': '---\n{"type":"person","email":"mara.quill@example.com"}\n---\n',
    });
    expect((await loadGranolaSettings({ fs, markdown: jsonMarkdown() })).selfEmails).toEqual([]);
  });

  it('is the defaults for a vault with no settings note', async () => {
    const { fs } = vaultWith({});
    expect(await loadGranolaSettings({ fs, markdown: jsonMarkdown() })).toEqual({
      timeZone: 'America/Los_Angeles',
      webhook: false,
      periodic: true,
      groupAddresses: [],
      selfEmails: [],
    });
  });
});

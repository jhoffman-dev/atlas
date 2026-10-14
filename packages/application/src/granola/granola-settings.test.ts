import { describe, expect, it } from 'vitest';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import {
  loadGranolaSettings,
  saveGranolaSelfEmails,
  suggestGranolaSelfEmails,
} from './granola-settings.ts';

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

describe('suggestGranolaSelfEmails', () => {
  const markdown = jsonMarkdown();
  const person = (fields: Record<string, unknown>) =>
    `---\n${JSON.stringify({ type: 'person', ...fields })}\n---\n\nbody\n`;
  const index = atlasQueryIndex({
    markdown,
    files: {
      'People/Mara Quill.md': person({
        email: 'Mara.Quill@example.com',
        other_emails: ['mara@example.com'],
      }),
      'People/Tobias Fenn.md': person({ email: 'tobias.fenn@example.com' }),
    },
  });

  it('offers the addresses of the Person note the profile names', async () => {
    const { fs } = vaultWith({ [SETTINGS]: '---\n{"profileName":"Mara Quill"}\n---\n' });
    expect(await suggestGranolaSelfEmails({ fs, markdown, index: { query: index } })).toEqual([
      'mara.quill@example.com',
      'mara@example.com',
    ]);
  });

  it('offers none when the profile names no one', async () => {
    const { fs } = vaultWith({});
    expect(await suggestGranolaSelfEmails({ fs, markdown, index: { query: index } })).toEqual([]);
  });
});

describe('saveGranolaSelfEmails', () => {
  it('saves the addresses as a list, and none as no setting', async () => {
    const saved: Record<string, unknown>[] = [];
    const settings = { save: async (changes: Record<string, unknown>) => void saved.push(changes) };
    await saveGranolaSelfEmails({ settings, emails: ['mara.quill@example.com'] });
    await saveGranolaSelfEmails({ settings, emails: [] });
    expect(saved).toEqual([
      { granola_self_emails: ['mara.quill@example.com'] },
      { granola_self_emails: null },
    ]);
  });
});

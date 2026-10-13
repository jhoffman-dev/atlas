import { describe, expect, it } from 'vitest';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import { loadGranolaMappingOptions, loadGranolaSettings } from './granola-settings.ts';

const SETTINGS = '.atlas/settings.md';

describe('loadGranolaSettings', () => {
  it('reads Granola’s settings from the vault’s settings note', async () => {
    const { fs } = vaultWith({
      [SETTINGS]:
        '---\n{"granola_time_zone":"Europe/London","granola_webhook":true,"granola_periodic":false}\n---\n',
    });
    expect(await loadGranolaSettings({ fs, markdown: jsonMarkdown() })).toEqual({
      timeZone: 'Europe/London',
      webhook: true,
      periodic: false,
      groupAddresses: [],
    });
  });

  it('is the defaults for a vault with no settings note', async () => {
    const { fs } = vaultWith({});
    expect(await loadGranolaSettings({ fs, markdown: jsonMarkdown() })).toMatchObject({
      timeZone: 'America/Los_Angeles',
      webhook: false,
      periodic: true,
    });
  });
});

describe('loadGranolaMappingOptions', () => {
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

  it('takes the zone and groups from the settings, and the person’s addresses from their own note', async () => {
    const options = await loadGranolaMappingOptions({
      settings: {
        profileName: 'Mara Quill',
        granola_time_zone: 'Asia/Tokyo',
        meeting_group_addresses: ['eng@example.com'],
      },
      index: { query: index },
    });
    expect(options).toEqual({
      timeZone: 'Asia/Tokyo',
      groupAddresses: ['eng@example.com'],
      selfEmails: ['mara.quill@example.com', 'mara@example.com'],
    });
  });

  it('has no addresses of the person’s own when the profile names no one', async () => {
    const options = await loadGranolaMappingOptions({ settings: {}, index: { query: index } });
    expect(options.selfEmails).toEqual([]);
    expect(options.timeZone).toBe('America/Los_Angeles');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createSettingsWriter } from '../settings/index.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import { loadSelfEmails, saveSelfEmails, suggestSelfEmails } from './self-emails-setting.ts';

/** #173: the owner's addresses, `selfEmails` in the vault's settings note beside the profile. */

const PATH = '.atlas/settings.md';

describe('loadSelfEmails', () => {
  it('reads none, from nowhere, when the vault has no settings file', async () => {
    const { fs } = vaultWith({});
    expect(await loadSelfEmails({ fs, markdown: jsonMarkdown() })).toEqual({
      emails: [],
      source: null,
      problem: null,
    });
  });

  it('reads selfEmails, and the Granola alias only while selfEmails is empty', async () => {
    const both = vaultWith({
      [PATH]:
        '---\n{"selfEmails":["mq@example.org"],"granola_self_emails":["mara.quill@example.com"]}\n---\n',
    });
    const alias = vaultWith({
      [PATH]: '---\n{"selfEmails":[],"granola_self_emails":["mara.quill@example.com"]}\n---\n',
    });

    expect(await loadSelfEmails({ fs: both.fs, markdown: jsonMarkdown() })).toEqual({
      emails: ['mq@example.org'],
      source: 'selfEmails',
      problem: null,
    });
    expect(await loadSelfEmails({ fs: alias.fs, markdown: jsonMarkdown() })).toEqual({
      emails: ['mara.quill@example.com'],
      source: 'granola_self_emails',
      problem: null,
    });
  });

  it('takes no address from the profile’s Person note: only what the setting holds', async () => {
    const { fs } = vaultWith({
      [PATH]: '---\n{"profileName":"Mara Quill"}\n---\n',
      'People/Mara Quill.md': '---\n{"type":"person","email":"mara.quill@example.com"}\n---\n',
    });
    expect((await loadSelfEmails({ fs, markdown: jsonMarkdown() })).emails).toEqual([]);
  });

  it('refuses a settings note it cannot read, rather than reading no addresses', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{not json\n---\n' });
    await expect(loadSelfEmails({ fs, markdown: jsonMarkdown() })).rejects.toThrow(PATH);
  });
});

describe('saveSelfEmails', () => {
  it('round-trips: what is saved is what is read, beside the profile and the other settings', async () => {
    const { fs, written } = vaultWith({
      [PATH]: '---\n{"profileName":"Mara Quill","quickAdd":["task"]}\n---\n\nMine.\n',
    });
    const markdown = jsonMarkdown();

    await saveSelfEmails({
      settings: createSettingsWriter({ fs, markdown }),
      emails: ['mara.quill@example.com', 'mq@example.org'],
    });

    expect(await loadSelfEmails({ fs, markdown })).toEqual({
      emails: ['mara.quill@example.com', 'mq@example.org'],
      source: 'selfEmails',
      problem: null,
    });
    expect(written[PATH]).toContain('"profileName":"Mara Quill"');
    expect(written[PATH]).toContain('"quickAdd":["task"]');
    expect(written[PATH]).toContain('Mine.');
  });

  it('moves the Granola alias into selfEmails in one write, and removes both for none', async () => {
    const { fs, written } = vaultWith({
      [PATH]: '---\n{"granola_self_emails":["mara.quill@example.com"]}\n---\n',
    });
    const markdown = jsonMarkdown();
    const settings = createSettingsWriter({ fs, markdown });
    const writes = vi.spyOn(fs, 'writeTextFile');

    await saveSelfEmails({ settings, emails: ['mq@example.org'] });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(written[PATH]).toContain('"selfEmails":["mq@example.org"]');
    // The alias removed: null to the settings writer, which the markdown port drops.
    expect(written[PATH]).toContain('"granola_self_emails":null');
    expect(await loadSelfEmails({ fs, markdown })).toMatchObject({
      emails: ['mq@example.org'],
      source: 'selfEmails',
    });

    // None is the key removed (null to the settings writer), never an empty list,
    // and no older addresses are left to be read in its place.
    await saveSelfEmails({ settings, emails: [] });
    expect(written[PATH]).toContain('"selfEmails":null');
    expect(await loadSelfEmails({ fs, markdown })).toEqual({
      emails: [],
      source: null,
      problem: null,
    });
  });

  it('clears the Granola alias when none is saved while only it holds addresses', async () => {
    const { fs, written } = vaultWith({
      [PATH]:
        '---\n{"profileName":"Mara Quill","granola_self_emails":["mara.quill@example.com"]}\n---\n',
    });
    const markdown = jsonMarkdown();
    await saveSelfEmails({ settings: createSettingsWriter({ fs, markdown }), emails: [] });
    expect(written[PATH]).toContain('"granola_self_emails":null');
    expect(written[PATH]).toContain('"profileName":"Mara Quill"');
    expect((await loadSelfEmails({ fs, markdown })).emails).toEqual([]);
  });

  it('passes on a write the host refuses', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{}\n---\n' });
    const refusing = { ...fs, writeTextFile: () => Promise.reject(new Error('read-only')) };
    await expect(
      saveSelfEmails({
        settings: createSettingsWriter({ fs: refusing, markdown: jsonMarkdown() }),
        emails: ['mara.quill@example.com'],
      }),
    ).rejects.toThrow('read-only');
  });
});

describe('suggestSelfEmails', () => {
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

  it('offers the addresses of the Person note the profile names, for the person to keep or not', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{"profileName":"Mara Quill"}\n---\n' });
    expect(await suggestSelfEmails({ fs, markdown, index: { query: index } })).toEqual([
      'mara.quill@example.com',
      'mara@example.com',
    ]);
  });

  it('offers none when the profile names no one', async () => {
    const { fs } = vaultWith({});
    expect(await suggestSelfEmails({ fs, markdown, index: { query: index } })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { createSettingsWriter } from '../settings/index.ts';
import { jsonMarkdown, vaultWith } from '../testing/settings-vault.ts';
import { loadSidebarOrder, saveSidebarOrder } from './sidebar-order.ts';

const PATH = '.atlas/settings.md';

describe('loadSidebarOrder', () => {
  it('reads unset when the vault has no settings file', async () => {
    const { fs } = vaultWith({});
    expect(await loadSidebarOrder({ fs, markdown: jsonMarkdown() })).toBeNull();
  });

  it('reads unset when the settings do not mention the sidebar', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{"quickAdd":["task"]}\n---\n' });
    expect(await loadSidebarOrder({ fs, markdown: jsonMarkdown() })).toBeNull();
  });

  it('reads the listed sections through the domain rules', async () => {
    const { fs } = vaultWith({
      [PATH]: '---\n{"sidebarOrder":["userSpace","inbox","views","views"]}\n---\n',
    });
    expect(await loadSidebarOrder({ fs, markdown: jsonMarkdown() })).toEqual([
      'userSpace',
      'views',
    ]);
  });
});

describe('saveSidebarOrder', () => {
  it('writes beside the other settings, keeping them and the words', async () => {
    const { fs, written } = vaultWith({
      [PATH]: '---\n{"quickAdd":["task"]}\n---\n\nMy notes.\n',
    });
    await saveSidebarOrder({
      settings: createSettingsWriter({ fs, markdown: jsonMarkdown() }),
      order: ['views', 'favorites', 'types', 'dashboards', 'userSpace'],
    });

    expect(written[PATH]).toContain('"quickAdd":["task"]');
    expect(written[PATH]).toContain(
      '"sidebarOrder":["views","favorites","types","dashboards","userSpace"]',
    );
    expect(written[PATH]).toContain('My notes.');
  });

  it('makes the settings file when there is none', async () => {
    const { fs, written, created } = vaultWith({});
    await saveSidebarOrder({
      settings: createSettingsWriter({ fs, markdown: jsonMarkdown() }),
      order: ['types'],
    });

    expect(created).toEqual([PATH]);
    expect(written[PATH]).toContain('"sidebarOrder":["types"]');
  });

  it('passes on a write the host refuses', async () => {
    const { fs } = vaultWith({ [PATH]: '---\n{}\n---\n' });
    const refusing = { ...fs, writeTextFile: () => Promise.reject(new Error('read-only')) };
    await expect(
      saveSidebarOrder({
        settings: createSettingsWriter({ fs: refusing, markdown: jsonMarkdown() }),
        order: ['types'],
      }),
    ).rejects.toThrow('read-only');
  });
});

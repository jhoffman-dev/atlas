import { describe, expect, it } from 'vitest';
import { createVaultPath, NOT_DUPLICATE_PEOPLE_KEY } from '@dfai/domain';
import { refreshIndex } from '../index/refresh-index.ts';
import { createSettingsWriter } from '../settings/index.ts';
import {
  guardedVault,
  jsonFrontmatterMarkdown as markdown,
  jsonFrontmatterNote as note,
} from '../testing/guarded-vault.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import { dismissPossibleDuplicate, loadPossibleDuplicates } from './possible-duplicates.ts';

const SETTINGS = '.atlas/settings.md';

async function setUp(extra: Record<string, string> = {}) {
  const vault = guardedVault({
    'Tobias Fenn.md': note({ type: 'person', email: 'tobias@fenn.example' }, ''),
    'People/Tobias Fenn.md': note({ type: 'person' }, ''),
    'Mara.md': note({ type: 'person', email: 'mara@larkspur.example.com' }, ''),
    'People/Mara Quill.md': note({ type: 'person', email: 'mara.quill@larkspur.example.com' }, ''),
    'Larkspur Payroll.md': note({ type: 'company', aliases: ['Mara Quill'] }, ''),
    ...extra,
  });
  const index = sqliteIndexPort();
  await refreshIndex({ fs: vault.fs, index, markdown });
  return { vault, ports: { index, fs: vault.fs, markdown } };
}

const keys = (pairs: Awaited<ReturnType<typeof loadPossibleDuplicates>>) =>
  pairs.map((pair) => `${pair.left.path} + ${pair.right.path}`);

describe('the possible duplicate people in a vault', () => {
  it('pairs people by name and address from the index, leaving companies out', async () => {
    const { ports } = await setUp();
    expect(keys(await loadPossibleDuplicates(ports))).toEqual([
      'People/Tobias Fenn.md + Tobias Fenn.md',
      'Mara.md + People/Mara Quill.md',
    ]);
  });

  it('leaves out a pair the settings remember as two people', async () => {
    const { ports } = await setUp({
      [SETTINGS]: note(
        { [NOT_DUPLICATE_PEOPLE_KEY]: [['Tobias Fenn.md', 'People/Tobias Fenn.md']] },
        '',
      ),
    });
    expect(keys(await loadPossibleDuplicates(ports))).toEqual(['Mara.md + People/Mara Quill.md']);
  });

  it('fails rather than offering pairs said not to be one, when the settings cannot be read', async () => {
    const { ports } = await setUp({ [SETTINGS]: '---\nBROKEN\n---\n' });
    await expect(loadPossibleDuplicates(ports)).rejects.toThrow("can't be read");
  });
});

describe('saying two people are not one', () => {
  it('remembers the pair in the settings, beside the pairs already there, and the list leaves it out', async () => {
    const { vault, ports } = await setUp({
      [SETTINGS]: note(
        { selfEmails: ['me@example.com'], [NOT_DUPLICATE_PEOPLE_KEY]: [['A.md', 'B.md']] },
        '# Settings\n',
      ),
    });
    const settings = createSettingsWriter({ fs: vault.fs, markdown });
    await dismissPossibleDuplicate({
      ports,
      settings,
      pair: { left: createVaultPath('Mara.md'), right: createVaultPath('People/Mara Quill.md') },
    });
    const held = markdown.frontmatterProperties(vault.text(SETTINGS)!.split('\n# Settings')[0]!);
    expect(held).toEqual({
      selfEmails: ['me@example.com'],
      [NOT_DUPLICATE_PEOPLE_KEY]: [
        ['A.md', 'B.md'],
        ['Mara.md', 'People/Mara Quill.md'],
      ],
    });
    expect(keys(await loadPossibleDuplicates(ports))).toEqual([
      'People/Tobias Fenn.md + Tobias Fenn.md',
    ]);
  });
});

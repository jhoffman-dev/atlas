/**
 * The person's Archive and Unarchive on PARA notes (#213, ADR-0037): a
 * Project — or a note of the Area or Resource type from before — is
 * archived by its `para` where it stands, keeping what it was, and comes
 * back to that value in one step whatever archived it. Every other note is
 * moved to the Archive and back, as it always was.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { ArchivePorts, UnsavedTyping } from './archive-notes.ts';
import { archiveNotesWithPara, unarchiveNotesWithPara } from './para-archive.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);
const TODAY = '2026-10-14';
const PROJECT_TYPE_FILE = '---\nname: project\nlabel: Project\n---\n';

function vault(
  notes: Record<string, string>,
  { dirty = [] as string[], unsavedTyping = 'save' as UnsavedTyping } = {},
) {
  const memory = memoryVault(notes);
  const flushed: string[] = [];
  const reloaded: string[] = [];
  const typing = new Set(dirty);
  const ports: ArchivePorts = {
    fs: fakeVaultFs({
      ...memory.fs,
      readNotes: async (paths) =>
        paths.flatMap((at) => {
          const text = memory.files.get(at);
          return text === undefined ? [] : [{ path: at, text, modified: 1, size: text.length }];
        }),
    }),
    markdown: fakeMarkdown(),
    index: fakeIndexPort(),
    editors: {
      state: (at) => (typing.has(at) ? 'dirty' : 'clean'),
      flush: async (paths) => {
        for (const at of paths) {
          flushed.push(at);
          typing.delete(at);
        }
      },
      follow: () => {},
      abandon: () => {},
      reload: (at) => reloaded.push(at),
    },
  };
  const batch = (paths: string[]) => ({
    ports,
    paths: paths.map(path),
    notePaths: [...memory.files.keys()].map(path),
    unsavedTyping,
  });
  return {
    files: memory.files,
    flushed,
    reloaded,
    archive: (paths: string[]) => archiveNotesWithPara({ ...batch(paths), today: TODAY }),
    unarchive: (paths: string[]) => unarchiveNotesWithPara(batch(paths)),
  };
}

describe('Archive on a PARA note sets its value where it stands', () => {
  it('archives a Project by its PARA, keeping what it was, and moves nothing', async () => {
    const v = vault({ 'Areas/Garden.md': '---\ntype: project\npara: area\n---\n\n# Garden\n' });
    const outcome = await v.archive(['Areas/Garden.md']);
    expect(outcome).toMatchObject({ moves: [], failed: [], valued: ['Areas/Garden.md'] });
    expect(v.files.get('Areas/Garden.md')).toBe(
      '---\ntype: project\npara: archive\npara_before_archive: area\n---\n\n# Garden\n',
    );
    expect(v.reloaded).toEqual(['Areas/Garden.md']);
  });

  it('keeps Project as what a Project with no PARA was', async () => {
    const v = vault({ 'Projects/Ledger.md': '---\ntype: project\n---\n' });
    await v.archive(['Projects/Ledger.md']);
    expect(v.files.get('Projects/Ledger.md')).toBe(
      '---\ntype: project\npara: archive\npara_before_archive: project\n---\n',
    );
  });

  it('archives an Area note from before #213 as a Project, keeping that it was an area', async () => {
    const v = vault({
      '.atlas/types/project.md': PROJECT_TYPE_FILE,
      'Areas/Garden.md': '---\ntype: area\n---\n',
    });
    const outcome = await v.archive(['Areas/Garden.md']);
    expect(outcome.valued).toEqual(['Areas/Garden.md']);
    expect(v.files.get('Areas/Garden.md')).toBe(
      '---\ntype: project\npara: archive\npara_before_archive: area\n---\n',
    );
  });

  it('moves an Area note to the Archive in a vault with no Project type to put it on', async () => {
    const v = vault({ 'Areas/Garden.md': '---\ntype: area\n---\n' });
    const outcome = await v.archive(['Areas/Garden.md']);
    expect(outcome.valued).toEqual([]);
    expect(outcome.moves.map(({ move }) => move.to)).toEqual(['Archive/Areas/Garden.md']);
  });

  it('never writes over a PARA of the person’s own: that note is moved, its PARA kept', async () => {
    const v = vault({ 'Areas/Chores.md': '---\ntype: project\npara: Life admin\n---\n' });
    const outcome = await v.archive(['Areas/Chores.md']);
    expect(outcome.valued).toEqual([]);
    expect(v.files.has('Areas/Chores.md')).toBe(false);
    expect(v.files.get('Archive/Areas/Chores.md')).toContain('para: Life admin');
  });

  it('moves every other note to the Archive, in the same batch', async () => {
    const v = vault({
      'Projects/Ledger.md': '---\ntype: project\n---\n',
      'Tasks/Call Mara.md': '---\ntype: task\n---\n',
    });
    const outcome = await v.archive(['Projects/Ledger.md', 'Tasks/Call Mara.md']);
    expect(outcome.valued).toEqual(['Projects/Ledger.md']);
    expect(outcome.moves.map(({ move }) => move.to)).toEqual(['Archive/Tasks/Call Mara.md']);
    expect(v.files.has('Projects/Ledger.md')).toBe(true);
  });

  it('says a Project already archived by its value is already archived, and writes nothing', async () => {
    const text = '---\ntype: project\npara: archive\npara_before_archive: area\n---\n';
    const v = vault({ 'Projects/Ledger.md': text });
    const outcome = await v.archive(['Projects/Ledger.md']);
    expect(outcome.failed).toEqual([
      { path: 'Projects/Ledger.md', reason: 'It is already archived.' },
    ]);
    expect(v.files.get('Projects/Ledger.md')).toBe(text);
  });

  it('archives what is on screen: a pane’s typing is saved first', async () => {
    const v = vault(
      { 'Projects/Ledger.md': '---\ntype: project\n---\n' },
      { dirty: ['Projects/Ledger.md'] },
    );
    await v.archive(['Projects/Ledger.md']);
    expect(v.flushed).toEqual(['Projects/Ledger.md']);
    expect(v.files.get('Projects/Ledger.md')).toContain('para: archive');
  });

  it('leaves a note with unsaved typing alone when the batch must not save it', async () => {
    const text = '---\ntype: project\n---\n';
    const v = vault(
      { 'Projects/Ledger.md': text },
      { dirty: ['Projects/Ledger.md'], unsavedTyping: 'leave' },
    );
    const outcome = await v.archive(['Projects/Ledger.md']);
    expect(outcome.failed).toEqual([
      { path: 'Projects/Ledger.md', reason: expect.any(String), unsavedInApp: true },
    ]);
    expect(v.files.get('Projects/Ledger.md')).toBe(text);
  });
});

describe('Unarchive gives a PARA note back in one step, whatever archived it', () => {
  it('gives a Project archived where it stands the PARA it had, and takes the record off', async () => {
    const v = vault({
      'Areas/Garden.md': '---\ntype: project\npara: archive\npara_before_archive: area\n---\n',
    });
    const outcome = await v.unarchive(['Areas/Garden.md']);
    expect(outcome).toMatchObject({ moves: [], failed: [], valued: ['Areas/Garden.md'] });
    expect(v.files.get('Areas/Garden.md')).toBe('---\ntype: project\npara: area\n---\n');
  });

  it('gives Project back when nothing readable was kept', async () => {
    const v = vault({ 'Projects/Ledger.md': '---\ntype: project\npara: archive\n---\n' });
    await v.unarchive(['Projects/Ledger.md']);
    expect(v.files.get('Projects/Ledger.md')).toBe('---\ntype: project\npara: project\n---\n');
  });

  it('moves a Project in the Archive folder out and restores its PARA in the same step', async () => {
    const v = vault({
      'Archive/Resources/Style Guide.md': [
        '---',
        'type: project',
        'para: archive',
        'para_before_archive: resource',
        'archived: 2026-01-05',
        'archivedFrom: Resources/Style Guide.md',
        '---',
        '',
      ].join('\n'),
    });
    const outcome = await v.unarchive(['Archive/Resources/Style Guide.md']);
    expect(outcome.failed).toEqual([]);
    expect(outcome.moves.map(({ move }) => move.to)).toEqual(['Resources/Style Guide.md']);
    expect(v.files.get('Resources/Style Guide.md')).toBe(
      '---\ntype: project\npara: resource\n---\n',
    );
  });

  it('moves an Area note from before #213 out of the Archive folder as any note', async () => {
    const v = vault({
      'Archive/Areas/Garden.md': '---\ntype: area\narchivedFrom: Areas/Garden.md\n---\n',
    });
    await v.unarchive(['Archive/Areas/Garden.md']);
    expect(v.files.get('Areas/Garden.md')).toBe('---\ntype: area\n---\n');
  });

  it('refuses a note that is archived neither way', async () => {
    const v = vault({ 'Projects/Ledger.md': '---\ntype: project\npara: area\n---\n' });
    const outcome = await v.unarchive(['Projects/Ledger.md']);
    expect(outcome.failed).toEqual([{ path: 'Projects/Ledger.md', reason: 'It is not archived.' }]);
  });

  it('archives and unarchives back to exactly the bytes it started as', async () => {
    const text = '---\ntype: project\npara: resource\nowner: Mara Quill\n---\n\n# Style Guide\n';
    const v = vault({ 'Resources/Style Guide.md': text });
    await v.archive(['Resources/Style Guide.md']);
    await v.unarchive(['Resources/Style Guide.md']);
    expect(v.files.get('Resources/Style Guide.md')).toBe(
      '---\ntype: project\npara: resource\nowner: Mara Quill\n---\n\n# Style Guide\n',
    );
  });
});

describe('a note that cannot be read for its PARA', () => {
  it('is moved as any note is, and the move says why it could not go', async () => {
    const v = vault({});
    const outcome = await v.archive(['Projects/Gone.md']);
    expect(outcome.valued).toEqual([]);
    expect(outcome.failed.map((failure) => failure.path)).toEqual(['Projects/Gone.md']);
  });
});

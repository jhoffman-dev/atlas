/**
 * Processing the Inbox, over a vault held in memory that answers the way the
 * host does: a move refuses to overwrite and needs its folder to exist. What
 * is asserted is where each note ends up and what it says.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { FilingRefusedError, processInboxItems } from './process-inbox.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

const PROJECT = '---\ntype: project\nstatus: active\n---\n\n# Atlas\n';
const AREA = '---\ntype: area\n---\n\n# Garden\n';
const PERSON = '---\ntype: person\n---\n\n# Mara Quill\n';

function vault(files: Record<string, string>) {
  const memory = memoryVault(files);
  const reloaded: string[] = [];
  const ports: ArchivePorts = {
    fs: fakeVaultFs(memory.fs),
    markdown: fakeMarkdown(),
    index: fakeIndexPort(),
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: (at) => void reloaded.push(at),
    },
  };
  const process = (paths: string[], project: string) =>
    processInboxItems({
      ports,
      paths: paths.map(path),
      notePaths: [...memory.files.keys()].map(path),
      project: path(project),
    });
  return { files: memory.files, process };
}

describe('processInboxItems', () => {
  it('files a note under its project’s folder and links it', async () => {
    const v = vault({
      'Projects/Atlas.md': PROJECT,
      'Inbox/Call the bank.md': '---\ntype: task\nstatus: backlog\n---\n\nAbout the loan.\n',
    });

    const outcome = await v.process(['Inbox/Call the bank.md'], 'Projects/Atlas.md');

    expect(outcome.failed).toEqual([]);
    expect(outcome.moves.map(({ move }) => [move.from, move.to])).toEqual([
      ['Inbox/Call the bank.md', 'Projects/Atlas/Call the bank.md'],
    ]);
    expect(v.files.has('Inbox/Call the bank.md')).toBe(false);
    expect(v.files.get('Projects/Atlas/Call the bank.md')).toBe(
      '---\ntype: task\nstatus: backlog\nproject: [[Atlas]]\n---\n\nAbout the loan.\n',
    );
  });

  it('files a plain note with no frontmatter, giving it the link and keeping its text', async () => {
    const v = vault({ 'Projects/Atlas.md': PROJECT, 'Inbox/Idea.md': 'Just a thought.\n' });
    await v.process(['Inbox/Idea.md'], 'Projects/Atlas.md');
    expect(v.files.get('Projects/Atlas/Idea.md')).toBe(
      '---\nproject: [[Atlas]]\n---\nJust a thought.\n',
    );
  });

  it('files under an area as readily as a project, from any folder of the Inbox', async () => {
    const v = vault({
      'Areas/Garden.md': AREA,
      'Inbox/Meetings/2026-10-01 Seeds.md': '---\ntype: meeting\n---\n\nNotes.\n',
    });
    const outcome = await v.process(['Inbox/Meetings/2026-10-01 Seeds.md'], 'Areas/Garden.md');
    expect(outcome.moves.map(({ move }) => move.to)).toEqual(['Areas/Garden/2026-10-01 Seeds.md']);
    expect(v.files.get('Areas/Garden/2026-10-01 Seeds.md')).toContain('project: [[Garden]]');
  });

  it('numbers a note whose name the project’s folder already has', async () => {
    const v = vault({
      'Projects/Atlas.md': PROJECT,
      'Projects/Atlas/Notes.md': 'older\n',
      'Inbox/Notes.md': 'newer\n',
    });
    await v.process(['Inbox/Notes.md'], 'Projects/Atlas.md');
    expect(v.files.get('Projects/Atlas/Notes.md')).toBe('older\n');
    expect(v.files.get('Projects/Atlas/Notes 2.md')).toContain('newer');
  });

  it('refuses to file under a note of another type, and moves nothing', async () => {
    const v = vault({ 'People/Mara Quill.md': PERSON, 'Inbox/Call.md': 'x\n' });
    await expect(v.process(['Inbox/Call.md'], 'People/Mara Quill.md')).rejects.toThrow(
      new FilingRefusedError('Project links to a project or area, not a person'),
    );
    expect(v.files.get('Inbox/Call.md')).toBe('x\n');
  });

  it('refuses a project that is not there', async () => {
    const v = vault({ 'Inbox/Call.md': 'x\n' });
    await expect(v.process(['Inbox/Call.md'], 'Projects/Gone.md')).rejects.toThrow(
      FilingRefusedError,
    );
  });

  it('finds the project however the request cased its path', async () => {
    const v = vault({ 'Projects/Atlas.md': PROJECT, 'Inbox/Call.md': 'x\n' });
    const outcome = await v.process(['Inbox/Call.md'], 'projects/atlas.md');
    expect(outcome.moves.map(({ move }) => move.to)).toEqual(['Projects/Atlas/Call.md']);
  });

  it('reports a note that is not in the Inbox, and files the rest', async () => {
    const v = vault({
      'Projects/Atlas.md': PROJECT,
      'Elsewhere/Plan.md': 'p\n',
      'Inbox/Call.md': 'c\n',
    });
    const outcome = await v.process(['Elsewhere/Plan.md', 'Inbox/Call.md'], 'Projects/Atlas.md');
    expect(outcome.failed).toEqual([
      { path: 'Elsewhere/Plan.md', reason: 'It is not in the Inbox.' },
    ]);
    expect(v.files.get('Elsewhere/Plan.md')).toBe('p\n');
    expect(outcome.moves.map(({ move }) => move.to)).toEqual(['Projects/Atlas/Call.md']);
  });
});

/**
 * Filing from the Inbox — the desktop clarify flow and `POST
 * /v1/inbox/process` — refuses what a picker would never offer (#213). A
 * project in the Archive and a note of the Resource type were refused before
 * archiving was a value and resources were Project notes; a Project archived
 * by its value and one whose PARA is resource are refused the same way, with
 * the same words, and the note waiting in the Inbox stays where it is.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { FilingRefusedError, processInboxItems } from './process-inbox.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

function vault(files: Record<string, string>) {
  const memory = memoryVault(files);
  const ports: ArchivePorts = {
    fs: fakeVaultFs(memory.fs),
    markdown: fakeMarkdown(),
    index: fakeIndexPort(),
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  const process = (paths: string[], project: string) =>
    processInboxItems({
      ports,
      paths: paths.map(path),
      notePaths: [...memory.files.keys()].map(path),
      project: path(project),
      today: '2026-10-01',
    });
  return { files: memory.files, process };
}

describe('filing under a PARA note that is not a project or an area (#213)', () => {
  it('refuses a Project set to PARA archive, as it refused one moved to the Archive', async () => {
    const v = vault({
      'Projects/Larkspur Launch.md':
        '---\ntype: project\npara: archive\n---\n\n# Larkspur Launch\n',
      'Inbox/Call Mara.md': '---\ntype: task\nstatus: backlog\n---\n',
    });
    const filing = v.process(['Inbox/Call Mara.md'], 'Projects/Larkspur Launch.md');
    await expect(filing).rejects.toThrow(FilingRefusedError);
    await expect(filing).rejects.toThrow('That is archived: unarchive it to file notes under it.');
    expect(v.files.has('Inbox/Call Mara.md')).toBe(true);
  });

  it('refuses a resource, as it refused a note of the Resource type', async () => {
    const v = vault({
      'Resources/Style Guide.md': '---\ntype: project\npara: resource\n---\n\n# Style Guide\n',
      'Inbox/Call Mara.md': '---\ntype: task\nstatus: backlog\n---\n',
    });
    const filing = v.process(['Inbox/Call Mara.md'], 'Resources/Style Guide.md');
    await expect(filing).rejects.toThrow(FilingRefusedError);
    await expect(filing).rejects.toThrow('Project links to a project or area, not a resource');
    expect(v.files.has('Inbox/Call Mara.md')).toBe(true);
  });

  it('files under a Project whose PARA is area, as under a note of the Area type', async () => {
    const v = vault({
      'Areas/Garden.md': '---\ntype: project\npara: area\n---\n\n# Garden\n',
      'Inbox/Call Mara.md': '---\ntype: task\nstatus: backlog\n---\n',
    });
    await v.process(['Inbox/Call Mara.md'], 'Areas/Garden.md');
    expect(v.files.has('Inbox/Call Mara.md')).toBe(false);
  });
});

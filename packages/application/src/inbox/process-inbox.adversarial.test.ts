/**
 * Adversarial: processing the Inbox (P30-01), over the same in-memory vault
 * the use-case's own tests use. Each test names one invariant of Process:
 * a processed note leaves the Inbox and is never silently archived.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, isArchivedPath, isInInbox, type VaultPath } from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { processInboxItems } from './process-inbox.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

const PROJECT = '---\ntype: project\n---\n\n# Plan\n';

function vault(files: Record<string, string>) {
  const memory = memoryVault(files);
  const ports: ArchivePorts = {
    fs: fakeVaultFs({
      ...memory.fs,
      // Links are found by reading the vault's notes, so this vault answers that too.
      readNotes: async (paths) =>
        paths.flatMap((at) => {
          const text = memory.files.get(at);
          return text === undefined ? [] : [{ path: at, text, modified: 1, size: text.length }];
        }),
    }),
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
      notePaths: [...memory.files.keys()].filter((p) => /\.md$/i.test(p)).map(path),
      project: path(project),
      updateLinks: true,
    });
  return { files: memory.files, process };
}

/** Where the batch put each note, or the refusal that kept them all where they were. */
async function landings(run: () => Promise<{ moves: readonly { move: { to: string } }[] }>) {
  try {
    return (await run()).moves.map(({ move }) => move.to);
  } catch {
    return [];
  }
}

describe('processInboxItems — adversarial', () => {
  it('never files a note back into the Inbox, even under a project kept at Inbox.md', async () => {
    const v = vault({ 'Inbox.md': PROJECT, 'Inbox/Call Tobias.md': 'c\n' });

    const landed = await landings(() => v.process(['Inbox/Call Tobias.md'], 'Inbox.md'));

    // Processed or refused, a note is never "filed" somewhere that is still the Inbox.
    expect(landed.filter((to) => isInInbox(to))).toEqual([]);
  });

  it('never archives a note it files, even under a project kept at Archive.md', async () => {
    const v = vault({ 'Archive.md': PROJECT, 'Inbox/Call Tobias.md': 'c\n' });

    const landed = await landings(() => v.process(['Inbox/Call Tobias.md'], 'Archive.md'));

    expect(landed.filter((to) => isArchivedPath(to))).toEqual([]);
  });
});

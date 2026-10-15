/**
 * Filing an Inbox note moves it to its type's home (#214). A home at the same
 * depth as a namesake, sorting before it, would answer the namesake's bare
 * `[[links]]` first: the move re-points each such link to the path of the
 * note it opened, so no link changes what it opens (found by adv-222).
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, resolveWikiLinkTarget, type VaultPath } from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { processInboxItems } from './process-inbox.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

describe('filing a note whose name another note already answers to', () => {
  it('leaves [[Acme]] opening the note it opened before', async () => {
    const memory = memoryVault({
      'Projects/Atlas.md': '---\ntype: project\nstatus: active\n---\n',
      // An older, different Acme; every [[Acme]] in the vault opens it ("Customers" < "Inbox").
      'Customers/Acme.md': '# Acme Holdings, the customer\n',
      'Notes/Call log.md': 'Spoke to [[Acme]] about renewal.\n',
      // Captured into the Inbox: a different company that happens to share the name.
      'Inbox/Acme.md': '---\ntype: company\n---\n\nAcme Robotics, a prospect.\n',
    });
    const before = [...memory.files.keys()].map(path);
    expect(resolveWikiLinkTarget('Acme', before)).toBe('Customers/Acme.md');

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
    const outcome = await processInboxItems({
      ports,
      paths: [path('Inbox/Acme.md')],
      notePaths: before,
      project: path('Projects/Atlas.md'),
      today: '2026-10-14',
      updateLinks: true,
    });
    expect(outcome.moves.map(({ move }) => move.to)).toEqual(['Companies/Acme.md']);

    const after = [...memory.files.keys()].map(path);
    const callLog = memory.files.get('Notes/Call log.md') ?? '';
    const link = /\[\[([^\]]+)\]\]/.exec(callLog)?.[1] ?? '';
    // "Companies" < "Customers": unrewritten, the call log would open the prospect.
    expect(resolveWikiLinkTarget(link, after)).toBe('Customers/Acme.md');
    expect(callLog).toBe('Spoke to [[Customers/Acme]] about renewal.\n');
    expect(outcome.linksUpdated).toBe(1);
  });
});

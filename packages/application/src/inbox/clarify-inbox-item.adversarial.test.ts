/**
 * Adversarial pass on #112 (Inbox clarify): what the use-case lets a row, or
 * another tool, decide that the vault's own rules do not.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type Clarification } from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeIndexPort, fakeVaultFs } from '../testing/fake-ports.ts';
import { jsonLinesMarkdown, jsonLinesNote } from '../testing/proposal-vault.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { clarifyInboxItem, ClarifyRefusedError } from './clarify-inbox-item.ts';

const TODAY = '2026-10-12';

function vault(files: Record<string, string>) {
  const memory = memoryVault(files);
  const ports: ArchivePorts = {
    fs: fakeVaultFs({
      ...memory.fs,
      // The vault's types are read this way.
      readNotes: async (paths) =>
        paths.flatMap((at) => {
          const text = memory.files.get(at);
          return text === undefined ? [] : [{ path: at, text, modified: 1, size: text.length }];
        }),
    }),
    markdown: jsonLinesMarkdown(),
    index: fakeIndexPort(),
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  const clarify = (at: string, clarification: Clarification) =>
    clarifyInboxItem({
      ports,
      path: createVaultPath(at),
      clarification,
      notePaths: [...memory.files.keys()].map(createVaultPath),
      today: TODAY,
    });
  return { files: memory.files, ports, clarify };
}

describe('clarifyInboxItem — a vault on statuses of its own', () => {
  const CALL = 'Inbox/Call Tobias Fenn.md';
  const files = {
    '.atlas/types/task.md': jsonLinesNote({
      name: 'task',
      properties: { status: { kind: 'select', options: ['todo', 'doing', 'done'], done: 'done' } },
    }),
    [CALL]: jsonLinesNote({ type: 'task', status: 'todo' }, 'Ring the Larkspur Payroll desk.\n'),
  };

  it('reads that vault’s Task type as one that does not have Next Action', async () => {
    const v = vault(files);
    const types = await loadObjectTypes({ fs: v.ports.fs, markdown: v.ports.markdown });
    const status = types
      .find((type) => type.name === 'task')
      ?.properties.find((property) => property.key === 'status');
    expect(status).toMatchObject({ options: ['todo', 'doing', 'done'] });
  });

  it('never writes a status that vault’s Task type does not declare', async () => {
    const v = vault(files);
    await v.clarify(CALL, { status: 'next-action' }).catch((cause: unknown) => {
      if (!(cause instanceof ClarifyRefusedError)) throw cause;
    });
    expect(v.files.get(CALL)).toBe(files[CALL]);
  });
});

describe('clarifyInboxItem — a task that is not waiting', () => {
  it('refuses an archived task: the Inbox never lists one, so there is no row to decide it on', async () => {
    const old = 'Archive/Tasks/Old.md';
    const text = jsonLinesNote({ type: 'task', status: 'archive', completed: '2026-01-02' });
    const v = vault({ [old]: text });
    await expect(v.clarify(old, { status: 'next-action' })).rejects.toBeInstanceOf(
      ClarifyRefusedError,
    );
    expect(v.files.get(old)).toBe(text);
  });
});

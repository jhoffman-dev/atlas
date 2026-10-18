// @vitest-environment jsdom
/**
 * #130: the vault tidy says it is still reading while its preview is out, so
 * the Inbox can hold its rows until it is known, and says nothing once it is
 * known that there is nothing to move.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import {
  fakeIndexPort,
  fakeVaultFs,
  memoryVault,
  recordingActivity,
  type ArchivePorts,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useVaultTidy } from './use-vault-tidy.ts';

function setup({ files, open = true }: { files: Record<string, string>; open?: boolean }) {
  const memory = memoryVault(files);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const fs = fakeVaultFs({
    ...memory.fs,
    listNotes: async () =>
      [...memory.files.entries()].map(([path, text]) => ({
        name: path.split('/').at(-1) ?? path,
        path: createVaultPath(path),
        modified: 0,
        size: text.length,
      })),
    readNotes: async (paths) => {
      await held;
      return paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 0, size: text.length }];
      });
    },
  });
  const ports = { fs, markdown: remarkMarkdown, index: fakeIndexPort() } as unknown as ArchivePorts;
  const hook = renderHook(
    (props: { open: boolean }) =>
      useVaultTidy({
        ports,
        vaultKey: '/vault',
        indexReady: true,
        open: props.open,
        activity: recordingActivity(),
        onChanged: vi.fn(),
      }),
    { initialProps: { open } },
  );
  return { hook, release };
}

describe('useVaultTidy — while its preview is read (#130)', () => {
  it('says it is still reading until the preview is back, then offers the move', async () => {
    const { hook, release } = setup({ files: { 'Loose idea.md': 'A thought.\n' } });
    expect(hook.result.current?.reading).toBe(true);
    expect(hook.result.current?.preview).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(hook.result.current?.preview?.moves).toHaveLength(1));
    expect(hook.result.current?.reading).toBe(false);
  });

  it('says nothing once it is read and there is nothing to move', async () => {
    const { hook, release } = setup({ files: { 'Notes/2026/Filed.md': 'Filed.\n' } });
    expect(hook.result.current?.reading).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(hook.result.current).toBeNull());
  });

  it('says nothing while the Inbox is not showing', async () => {
    const { hook } = setup({ files: { 'Loose idea.md': 'A thought.\n' }, open: false });
    await act(async () => {});
    expect(hook.result.current).toBeNull();
  });
});

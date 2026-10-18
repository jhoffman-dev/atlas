// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import {
  createOwnWrites,
  fakeHostVaultFs,
  type HostVaultFsPort,
  type VaultWatchPort,
} from '@atlas/application';
import { boundToVault } from './bound-to-vault.ts';
import { useOutsideChanges } from './use-outside-changes.ts';

const VAULT_A = '/vaults/larkspur';
const VAULT_B = '/vaults/quill';
const NOTE = 'Notes/Plan.md';
const SAVE_REPORT = ['Notes/.Plan.md.atlas-tmp', NOTE];

/** The host: one disk per vault, written at a clock the test holds still, and a watcher the test speaks for. */
function aHost() {
  const disks = new Map<string, Map<string, { text: string; modified: number }>>();
  const diskOf = (vault: string) => disks.get(vault) ?? disks.set(vault, new Map()).get(vault)!;
  const state = { open: VAULT_A, failReads: false };
  const fs: HostVaultFsPort = fakeHostVaultFs({
    readNotes: async (paths) => {
      if (state.failReads) throw new Error('the host is busy');
      return paths.flatMap((path) => {
        const file = diskOf(state.open).get(path);
        return file === undefined ? [] : [{ path, ...file, size: file.text.length }];
      });
    },
    writeTextFile: async ({ path, contents, vault }) => {
      diskOf(vault).set(path, { text: contents, modified: 1_000 });
      return 1_000;
    },
  });
  let heard: ((paths: readonly string[]) => void) | null = null;
  const watch: VaultWatchPort = {
    start: async () => {},
    onChange: async (handler) => {
      heard = handler;
      return () => void (heard = null);
    },
  };
  return {
    fs,
    watch,
    state,
    outsideWrite: (path: string, text: string) =>
      diskOf(state.open).set(path, { text, modified: 1_000 }),
    report: async (paths: readonly string[]) => {
      await waitFor(() => expect(heard).not.toBeNull());
      await act(async () => {
        heard?.(paths);
        // One turn of the event loop: every read the report asked for has answered.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

function watching(host: ReturnType<typeof aHost>) {
  const ownWrites = createOwnWrites({ clock: { now: () => 50_000 } });
  const onChange = vi.fn();
  const rendered = renderHook(
    ({ vaultKey }: { vaultKey: string }) => {
      const { fs } = boundToVault({ fs: host.fs }, vaultKey, ownWrites);
      useOutsideChanges({ watch: host.watch, vaultKey, fs, ownWrites, onChange });
      return fs;
    },
    { initialProps: { vaultKey: VAULT_A } },
  );
  /** A save the app then refreshed for, as a tick or a drag is. */
  const save = async (contents: string) => {
    await rendered.result.current.writeTextFile({
      path: createVaultPath(NOTE),
      contents,
      expectedModified: null,
    });
    ownWrites.refreshed({ vault: VAULT_A, through: ownWrites.lastWrite() });
  };
  return { onChange, rendered, save };
}

describe('useOutsideChanges (#254)', () => {
  it('asks for nothing on the echo of the app’s own save', async () => {
    const host = aHost();
    const { onChange, save } = watching(host);
    await save('# Plan\n');
    await host.report(SAVE_REPORT);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still hears another program’s save in the same millisecond', async () => {
    const host = aHost();
    const { onChange, save } = watching(host);
    await save('# Plan\n');
    host.outsideWrite(NOTE, '# Plan, theirs\n');
    await host.report(SAVE_REPORT);
    expect(onChange).toHaveBeenCalledExactlyOnceWith([NOTE]);
  });

  it('hears the report in the vault opened next as a change, whatever was written in the last', async () => {
    const host = aHost();
    const { onChange, rendered, save } = watching(host);
    await save('# Plan\n');
    host.state.open = VAULT_B;
    rendered.rerender({ vaultKey: VAULT_B });
    host.outsideWrite(NOTE, '# Plan\n');
    await host.report([NOTE]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith([NOTE]);
  });

  it('hears every path when the host cannot say what is there', async () => {
    const host = aHost();
    const { onChange, save } = watching(host);
    await save('# Plan\n');
    host.state.failReads = true;
    await host.report(SAVE_REPORT);
    // The temporary is the app's either way; the note could not be told.
    expect(onChange).toHaveBeenCalledExactlyOnceWith([NOTE]);
  });
});

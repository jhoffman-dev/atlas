// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { fakeVaultFs, type VaultFsPort, recordingActivity } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useQuickAddSetting } from '../quick-add/use-quick-add-setting.ts';
import { useSidebarOrder } from './use-sidebar-order.ts';

/** Where the hooks under test record what they give up on; these tests do not read it. */
const ACTIVITY = recordingActivity();

const SETTINGS = '.atlas/settings.md';

/**
 * A vault that behaves like the host: a write naming a stale modification time
 * is refused, and creating a note that already exists fails.
 */
function hostLikeVault(initial: string | null) {
  const file = { text: initial, modified: 1 };
  const fs = fakeVaultFs({
    listDirectory: async () => [],
    readNotes: async () =>
      file.text === null
        ? []
        : [{ path: SETTINGS, text: file.text, modified: file.modified, size: 1 }],
    readTextFile: async () => ({ text: file.text ?? '', modified: file.modified }),
    writeTextFile: async ({ contents, expectedModified }) => {
      if (expectedModified !== null && expectedModified !== file.modified)
        throw new Error('the note changed on disk');
      file.text = contents;
      file.modified += 1;
      return file.modified;
    },
    createNote: async ({ contents }) => {
      if (file.text !== null) throw new Error('a note with that name already exists');
      file.text = contents;
    },
    createFolder: async () => undefined,
  });
  return { fs, file };
}

/** Both settings the sidebar and the add button keep, as the app mounts them side by side. */
const renderBoth = (fs: VaultFsPort, changeKey = '0') =>
  renderHook(
    ({ key }) => ({
      order: useSidebarOrder({
        fs,
        markdown: remarkMarkdown,
        vaultKey: 'v',
        changeKey: key,
        activity: ACTIVITY,
      }),
      quickAdd: useQuickAddSetting({
        fs,
        markdown: remarkMarkdown,
        vaultKey: 'v',
        changeKey: key,
        activity: ACTIVITY,
      }),
    }),
    { initialProps: { key: changeKey } },
  );

describe('sidebar order and quick add, sharing .atlas/settings.md', () => {
  it('keeps both changes when a reorder and a quick-add change are saved together', async () => {
    const { fs, file } = hostLikeVault('---\nquickAdd: [task]\nsidebarOrder: [views]\n---\n');
    const hook = renderBoth(fs);
    await waitFor(() => expect(hook.result.current.order.order.saved).toEqual(['views']));

    act(() => {
      hook.result.current.order.order.onChange?.(['userSpace', 'views']);
      hook.result.current.quickAdd.save(['task', 'note']);
    });

    await waitFor(() => expect(file.modified).toBeGreaterThan(1));
    // Let every queued write finish (or fail) before judging the file.
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(hook.result.current.order.problem).toBeNull();
    expect(hook.result.current.quickAdd.problem).toBeNull();
    expect(file.text).toContain('sidebarOrder: [userSpace, views]');
    expect(file.text).toContain('quickAdd: [task, note]');
  });

  it('keeps both changes when the first two settings are saved together in a vault with no settings note', async () => {
    const { fs, file } = hostLikeVault(null);
    const hook = renderBoth(fs);
    // `saved` is null before the read as well as after it; the sections can be
    // moved only once the vault has been read.
    await waitFor(() => expect(hook.result.current.order.order.onChange).toBeDefined());
    expect(hook.result.current.order.order.saved).toBeNull();

    act(() => {
      hook.result.current.order.order.onChange?.(['views']);
      hook.result.current.quickAdd.save(['task']);
    });

    await waitFor(() => expect(file.text).not.toBeNull());
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(hook.result.current.order.problem).toBeNull();
    expect(hook.result.current.quickAdd.problem).toBeNull();
    expect(file.text).toContain('views');
    expect(file.text).toContain('task');
  });
});

describe('useSidebarOrder while a save is in flight', () => {
  it('does not snap back to the old order when the vault is re-read before the write lands', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const file = { text: '---\nsidebarOrder: [views]\n---\n', modified: 1 };
    const fs = fakeVaultFs({
      readNotes: async () => [
        { path: SETTINGS, text: file.text, modified: file.modified, size: 1 },
      ],
      readTextFile: async () => ({ text: file.text, modified: file.modified }),
      writeTextFile: async ({ contents }) => {
        await held;
        file.text = contents;
        file.modified += 1;
        return file.modified;
      },
    });
    const hook = renderHook(
      ({ key }) =>
        useSidebarOrder({
          fs,
          markdown: remarkMarkdown,
          vaultKey: 'v',
          changeKey: key,
          activity: ACTIVITY,
        }),
      { initialProps: { key: '0' } },
    );
    await waitFor(() => expect(hook.result.current.order.saved).toEqual(['views']));

    act(() => hook.result.current.order.onChange?.(['types', 'views']));
    // Any other file in the vault changes (the index key moves) while the write is held.
    hook.rerender({ key: '1' });
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 0));
    });

    expect(hook.result.current.order.saved).toEqual(['types', 'views']);
    release();
  });
});

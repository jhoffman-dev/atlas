// @vitest-environment jsdom
/**
 * The vault's settings note is read once for every setting it holds, and not
 * again for a change that is not to it (#293): an autosave or a tick moves
 * the index, and used to read the note again once for each setting shown.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { fakeVaultFs, recordingActivity } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { queryWrapper } from '../reads/query-wrapper.tsx';
import { useProfileSetting } from '../profile/use-profile-setting.ts';
import { useSidebarOrder } from '../sidebar/use-sidebar-order.ts';
import { useQuickAddSetting } from '../quick-add/use-quick-add-setting.ts';

const SETTINGS = '.atlas/settings.md';
const ACTIVITY = recordingActivity();

function countingVault() {
  const file = {
    text: '---\nname: Mara Quill\nquickAdd: [task]\nsidebarOrder: [views, types]\n---\n',
  };
  const asked: string[][] = [];
  const fs = fakeVaultFs({
    readNotes: async (paths) => {
      asked.push([...paths]);
      return paths.includes(SETTINGS)
        ? [{ path: SETTINGS, text: file.text, modified: 1, size: file.text.length }]
        : [];
    },
  });
  const settingsReads = () => asked.filter((paths) => paths.includes(SETTINGS)).length;
  return { fs, file, settingsReads };
}

function renderSettings(fs: ReturnType<typeof countingVault>['fs']) {
  const { wrapper } = queryWrapper();
  return renderHook(
    ({ changeKey }: { changeKey: string }) => {
      const shared = { fs, markdown: remarkMarkdown, vaultKey: 'v', changeKey, activity: ACTIVITY };
      return {
        profile: useProfileSetting(shared),
        order: useSidebarOrder(shared),
        quickAdd: useQuickAddSetting(shared),
      };
    },
    { wrapper, initialProps: { changeKey: 'revision 1' } },
  );
}

const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) await act(async () => {});
};

describe('the settings note, read once', () => {
  it('is read once for every setting the window shows', async () => {
    const { fs, settingsReads } = countingVault();
    const hook = renderSettings(fs);
    await waitFor(() => expect(hook.result.current.quickAdd.configured).toEqual(['task']));
    await waitFor(() => expect(hook.result.current.order.order.saved).toEqual(['views', 'types']));
    await settle();

    expect(settingsReads()).toBe(1);
  });

  it('is not read again when the index moves for a note that is not it', async () => {
    const { fs, settingsReads } = countingVault();
    const hook = renderSettings(fs);
    await waitFor(() => expect(hook.result.current.quickAdd.configured).toEqual(['task']));
    await settle();
    const before = settingsReads();

    hook.rerender({ changeKey: 'revision 2' });
    await settle();

    expect(settingsReads() - before).toBe(0);
  });
});

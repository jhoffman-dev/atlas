// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { recordingActivity } from '@atlas/application';
import { useVaultSetting } from './use-vault-setting.ts';

/** A read that does not come back until `release`, or fails when `fail` is called. */
function pendingRead(value: string) {
  let release = () => {};
  let fail: (cause: Error) => void = () => {};
  const load = () =>
    new Promise<string | null>((resolve, reject) => {
      release = () => resolve(value);
      fail = reject;
    });
  return { load, release: () => release(), fail: (cause: Error) => fail(cause) };
}

function renderSetting(
  initial: { load: () => Promise<string | null>; vaultKey: string },
  /** What the settings note's writer says to every save, when it says no. */
  refuse: string | null = null,
) {
  const stored: { next: string; previous: string | null }[] = [];
  const activity = recordingActivity();
  const hook = renderHook(
    (props: { load: () => Promise<string | null>; vaultKey: string }) =>
      useVaultSetting<string>({
        ...props,
        changeKey: '0',
        activity,
        store: (next, previous) => {
          if (refuse !== null) return Promise.reject(new Error(refuse));
          stored.push({ next, previous });
          return Promise.resolve();
        },
      }),
    { initialProps: initial },
  );
  return { hook, stored, activity };
}

describe('useVaultSetting across a vault switch', () => {
  it("does not hand out vault A's value while vault B is read", async () => {
    const { hook } = renderSetting({ load: () => Promise.resolve('from A'), vaultKey: 'a' });
    await waitFor(() => expect(hook.result.current.value).toBe('from A'));

    const b = pendingRead('from B');
    hook.rerender({ load: b.load, vaultKey: 'b' });
    expect(hook.result.current.loaded).toBe(false);
    expect(hook.result.current.value).toBeNull();

    act(() => b.release());
    await waitFor(() => expect(hook.result.current.value).toBe('from B'));
    expect(hook.result.current.loaded).toBe(true);
  });

  it("does not hand out vault A's value when vault B cannot be read", async () => {
    const { hook } = renderSetting({ load: () => Promise.resolve('from A'), vaultKey: 'a' });
    await waitFor(() => expect(hook.result.current.value).toBe('from A'));

    const b = pendingRead('never');
    hook.rerender({ load: b.load, vaultKey: 'b' });
    act(() => b.fail(new Error('settings.md: two keys named profileName')));
    await waitFor(() => expect(hook.result.current.unreadable).toContain('settings.md'));
    expect(hook.result.current.value).toBeNull();
  });

  it('hands the store the value it replaces in this vault, and none from another', async () => {
    const { hook, stored } = renderSetting({
      load: () => Promise.resolve('from A'),
      vaultKey: 'a',
    });
    await waitFor(() => expect(hook.result.current.value).toBe('from A'));
    act(() => hook.result.current.save('new in A'));

    const b = pendingRead('from B');
    hook.rerender({ load: b.load, vaultKey: 'b' });
    act(() => hook.result.current.save('new in B'));

    expect(stored).toEqual([
      { next: 'new in A', previous: 'from A' },
      { next: 'new in B', previous: null },
    ]);
  });
});

describe('useVaultSetting and the Activity log', () => {
  it('records a save it gives up on, once', async () => {
    const { hook, activity } = renderSetting(
      { load: () => Promise.resolve('from A'), vaultKey: 'a' },
      'The settings note is locked.',
    );
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => hook.result.current.save('changed'));
    await waitFor(() => expect(hook.result.current.problem).toBe('The settings note is locked.'));
    expect(activity.reports).toEqual([
      {
        level: 'error',
        kind: 'save',
        message: 'Could not save a setting. The settings note is locked.',
        subject: null,
      },
    ]);
  });

  it('records nothing for a save that lands', async () => {
    const { hook, stored, activity } = renderSetting({
      load: () => Promise.resolve('from A'),
      vaultKey: 'a',
    });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => hook.result.current.save('changed'));
    await waitFor(() => expect(stored).toHaveLength(1));
    expect(hook.result.current.problem).toBeNull();
    expect(activity.reports).toEqual([]);
  });
});

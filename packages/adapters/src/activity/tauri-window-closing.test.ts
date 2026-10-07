import { beforeEach, describe, expect, it, vi } from 'vitest';

type CloseHandler = () => Promise<void>;
const handlers: CloseHandler[] = [];
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: CloseHandler) => {
      handlers.push(handler);
      return unlisten;
    },
  }),
}));

const { tauriWindowClosing } = await import('./tauri-window-closing.ts');

describe('tauriWindowClosing', () => {
  beforeEach(() => {
    handlers.length = 0;
    unlisten.mockReset();
  });

  it('runs the task when the window is asked to close, and answers the way to stop', async () => {
    const task = vi.fn(async () => undefined);
    const stop = await tauriWindowClosing.beforeClose(task);
    expect(task).not.toHaveBeenCalled();
    await handlers[0]?.();
    expect(task).toHaveBeenCalledTimes(1);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('settles even when the task fails, so the window still closes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await tauriWindowClosing.beforeClose(() => Promise.reject(new Error('disk gone')));
    await expect(handlers[0]?.()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      'Work before closing the window failed:',
      new Error('disk gone'),
    );
    error.mockRestore();
  });
});

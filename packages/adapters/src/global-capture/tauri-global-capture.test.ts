import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_CAPTURE_EVENT } from '@atlas/application';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

/** The one handler `listen` was given, so a test can deliver the host's event to it. */
let deliver: ((event: { payload: unknown }) => void) | null = null;
const unlisten = vi.fn();
const listen = vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
  deliver = handler;
  return unlisten;
});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => listen(event, handler),
}));

const { tauriGlobalCapture } = await import('./tauri-global-capture.ts');

const HELD = { shortcut: 'Control+Alt+KeyN', registered: true, problem: null };

describe('tauriGlobalCapture', () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockClear();
    deliver = null;
  });

  it('reads and changes the shortcut through the host', async () => {
    invoke.mockResolvedValue(HELD);
    await expect(tauriGlobalCapture.status()).resolves.toEqual(HELD);
    await tauriGlobalCapture.set('Super+Space');
    await tauriGlobalCapture.set(null);
    expect(invoke.mock.calls).toEqual([
      ['global_capture_status'],
      ['global_capture_set', { shortcut: 'Super+Space' }],
      ['global_capture_set', { shortcut: null }],
    ]);
  });

  it("turns the host's refusal, a plain string, into an Error", async () => {
    invoke.mockRejectedValue('a global shortcut needs ⌘, ⌥ or ⌃');
    await expect(tauriGlobalCapture.set('KeyN')).rejects.toThrow(
      new Error('a global shortcut needs ⌘, ⌥ or ⌃'),
    );
  });

  it('calls back on each press the host announces, and stops when told', async () => {
    const pressed = vi.fn();
    const stop = await tauriGlobalCapture.listen(pressed);
    expect(listen).toHaveBeenCalledWith(GLOBAL_CAPTURE_EVENT, expect.any(Function));

    deliver?.({ payload: null });
    deliver?.({ payload: null });
    expect(pressed).toHaveBeenCalledTimes(2);

    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

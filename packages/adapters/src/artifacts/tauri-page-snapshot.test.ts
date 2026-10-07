import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriPageSnapshot } = await import('./tauri-page-snapshot.ts');

const REQUEST = {
  html: '<p>café</p>',
  width: 1280,
  height: 800,
  pictureWidth: 640,
  settleMs: 800,
  timeoutMs: 15_000,
};

describe('tauriPageSnapshot', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('sends the page as UTF-8 in the body and the numbers as headers, and hands back the bytes', async () => {
    invoke.mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);

    const picture = await tauriPageSnapshot.capture(REQUEST);

    expect(picture).toEqual(new Uint8Array([137, 80, 78, 71]));
    const [command, body, options] = invoke.mock.calls[0] ?? [];
    expect(command).toBe('snapshot_page');
    expect(new TextDecoder().decode(body as Uint8Array)).toBe('<p>café</p>');
    expect(options).toEqual({
      headers: {
        'atlas-width': '1280',
        'atlas-height': '800',
        'atlas-picture-width': '640',
        'atlas-settle-ms': '800',
        'atlas-timeout-ms': '15000',
      },
    });
  });

  it("turns the host's refusal into an Error", async () => {
    invoke.mockImplementation(() => Promise.reject('thumbnails are made on macOS only'));
    await expect(tauriPageSnapshot.capture(REQUEST)).rejects.toThrow(
      'thumbnails are made on macOS only',
    );
  });
});

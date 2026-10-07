// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import { fakeVaultFs } from '@atlas/application';
import { useImages } from './use-images.ts';

/** A vault holding only `files`; any other path cannot be read. */
function vaultWith(...files: string[]) {
  const readBinaryFile = vi.fn(async (path: string) => {
    if (!files.includes(path)) throw new Error(`No such file: ${path}`);
    return new TextEncoder().encode(path).buffer;
  });
  return { fs: fakeVaultFs({ readBinaryFile }), readBinaryFile };
}

afterEach(() => vi.unstubAllGlobals());

describe('useImages', () => {
  it('shows an image from the vault root when the note folder has no such file', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:found',
      revokeObjectURL: () => {},
    });
    const { fs, readBinaryFile } = vaultWith('attachments/x.png');
    const { result } = renderHook(() => useImages({ fs, notePath: createVaultPath('Notes/a.md') }));

    expect(await result.current('attachments/x.png')).toBe('blob:found');
    expect(readBinaryFile.mock.calls.map(([path]) => path)).toEqual([
      'Notes/attachments/x.png',
      'attachments/x.png',
    ]);
  });

  it('shows nothing for an image that is in neither place', async () => {
    const { fs } = vaultWith();
    const { result } = renderHook(() => useImages({ fs, notePath: createVaultPath('Notes/a.md') }));
    expect(await result.current('attachments/x.png')).toBeNull();
  });
});

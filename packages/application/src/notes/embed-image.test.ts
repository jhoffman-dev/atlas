import { describe, expect, it } from 'vitest';
import { createVaultPath, type IncomingImage, type VaultEntry } from '@atlas/domain';
import { embedImage, ImageEmbedError, type ImageProbePort } from './embed-image.ts';
import { fakeVaultFs } from '../testing/fake-ports.ts';

const NOW = '2026-09-25T14:30:12';
const BYTES = new Uint8Array([137, 80, 78, 71]);
const showsAll: ImageProbePort = { canShow: async () => true };

const screenshot: IncomingImage = {
  name: 'image.png',
  mimeType: 'image/png',
  size: BYTES.byteLength,
  origin: 'clipboard',
};

/** A vault of folders holding files, in memory, as the host keeps it. */
function memoryVault(folders: Record<string, string[]> = {}) {
  const contents = new Map(Object.entries(folders).map(([path, names]) => [path, [...names]]));
  const written: { path: string; bytes: Uint8Array }[] = [];
  const madeFolders: string[] = [];
  const fs = fakeVaultFs({
    listDirectory: async (path) => {
      const names = contents.get(path);
      if (names === undefined) throw new Error('no such folder');
      return names.map((name): VaultEntry => ({
        kind: 'file',
        name,
        path: createVaultPath(path === '' ? name : `${path}/${name}`),
      }));
    },
    createFolder: async ({ path }) => {
      if (contents.has(path)) throw new Error('something with that name is already there');
      contents.set(path, []);
      madeFolders.push(path);
    },
    writeBinaryFile: async ({ path, bytes, offset }) => {
      const at = path.lastIndexOf('/');
      const folder = at < 0 ? '' : path.slice(0, at);
      const name = path.slice(at + 1);
      const names = contents.get(folder);
      if (names === undefined) throw new Error('no such folder');
      if (names.includes(name)) throw new Error('a file with that name already exists');
      names.push(name);
      written.push({ path, bytes });
      return offset + bytes.byteLength;
    },
  });
  return { fs, contents, written, madeFolders };
}

const embed = (
  vault: ReturnType<typeof memoryVault>,
  overrides: Partial<Parameters<typeof embedImage>[0]> = {},
) =>
  embedImage({
    fs: vault.fs,
    probe: showsAll,
    notePath: createVaultPath('Work/Plans/q3.md'),
    image: screenshot,
    readBytes: async () => BYTES,
    placement: 'attachments',
    now: NOW,
    ...overrides,
  });

describe('embedImage', () => {
  it('saves a pasted screenshot in attachments/, named by the time, and points the note at it', async () => {
    const vault = memoryVault({ '': [], 'Work/Plans': ['q3.md'] });
    const embedded = await embed(vault);

    expect(vault.madeFolders).toEqual(['attachments']);
    expect(vault.written).toEqual([
      { path: 'attachments/Pasted image 20260925143012.png', bytes: BYTES },
    ]);
    expect(embedded).toEqual({
      path: 'attachments/Pasted image 20260925143012.png',
      src: '../../attachments/Pasted%20image%2020260925143012.png',
      alt: '',
    });
  });

  it('uses an attachments/ folder that is already there', async () => {
    const vault = memoryVault({ attachments: ['old.png'] });
    await embed(vault);
    expect(vault.madeFolders).toEqual([]);
    expect(vault.contents.get('attachments')).toContain('Pasted image 20260925143012.png');
  });

  it('saves beside the note when that is the setting', async () => {
    const vault = memoryVault({ 'Work/Plans': ['q3.md'] });
    const embedded = await embed(vault, {
      placement: 'beside-note',
      image: { name: 'Road map.jpg', mimeType: 'image/jpeg', size: 4, origin: 'file' },
    });
    expect(embedded).toEqual({
      path: 'Work/Plans/Road map.jpg',
      src: 'Road%20map.jpg',
      alt: 'Road map',
    });
  });

  it('numbers the name past every file already there, in any case, and never overwrites', async () => {
    const vault = memoryVault({ attachments: ['chart.png', 'Chart 2.PNG'] });
    const embedded = await embed(vault, {
      image: { name: 'chart.png', mimeType: 'image/png', size: 4, origin: 'file' },
    });
    expect(embedded.path).toBe('attachments/chart 3.png');
    expect(vault.contents.get('attachments')).toEqual(['chart.png', 'Chart 2.PNG', 'chart 3.png']);
  });

  it('numbers past a name taken between the listing and the write', async () => {
    const vault = memoryVault({ attachments: [] });
    const write = vault.fs.writeBinaryFile;
    let raced = false;
    vault.fs.writeBinaryFile = async (args) => {
      if (!raced) {
        raced = true;
        vault.contents.get('attachments')?.push('Pasted image 20260925143012.png');
      }
      return write(args);
    };
    const embedded = await embed(vault);
    expect(embedded.path).toBe('attachments/Pasted image 20260925143012 2.png');
  });

  it('refuses a kind of file a note cannot hold, writing nothing', async () => {
    const vault = memoryVault({ attachments: [] });
    await expect(
      embed(vault, {
        image: { name: 'scan.tiff', mimeType: 'image/tiff', size: 4, origin: 'file' },
      }),
    ).rejects.toThrow(
      new ImageEmbedError(
        '“scan.tiff” is not an image a note can hold. Use PNG, JPEG, GIF, WebP, SVG or HEIC.',
      ),
    );
    expect(vault.written).toEqual([]);
  });

  it('refuses an image over the size cap without reading it, writing nothing', async () => {
    const vault = memoryVault({ attachments: [] });
    let read = false;
    await expect(
      embed(vault, {
        image: { ...screenshot, size: 21 * 1024 * 1024 },
        readBytes: async () => {
          read = true;
          return BYTES;
        },
      }),
    ).rejects.toThrow(/at most 20 MB/);
    expect(read).toBe(false);
    expect(vault.written).toEqual([]);
  });

  it('refuses an image the webview cannot draw, asking it with the saved kind', async () => {
    const vault = memoryVault({ attachments: [] });
    const asked: string[] = [];
    const probe: ImageProbePort = {
      canShow: async ({ mimeType }) => {
        asked.push(mimeType);
        return false;
      },
    };
    await expect(
      embed(vault, {
        probe,
        image: { name: 'IMG_0001.HEIC', mimeType: '', size: 4, origin: 'file' },
      }),
    ).rejects.toThrow(/HEIC photo this Mac cannot show/);
    expect(asked).toEqual(['image/heic']);
    expect(vault.written).toEqual([]);
    expect(vault.madeFolders).toEqual([]);
  });

  it('says so when the host refuses the write for another reason, and does not retry', async () => {
    const vault = memoryVault({ attachments: [] });
    let tries = 0;
    vault.fs.writeBinaryFile = async () => {
      tries += 1;
      throw new Error('the disk is full');
    };
    await expect(embed(vault)).rejects.toThrow(
      new ImageEmbedError('The image could not be saved: the disk is full'),
    );
    expect(tries).toBe(1);
  });

  it('gives up after three names taken in a row', async () => {
    const vault = memoryVault({ attachments: [] });
    let tries = 0;
    vault.fs.writeBinaryFile = async ({ path }) => {
      tries += 1;
      vault.contents.get('attachments')?.push(path.slice('attachments/'.length));
      throw new Error('a file with that name already exists');
    };
    await expect(embed(vault)).rejects.toThrow(/already exists/);
    expect(tries).toBe(3);
  });

  it('saves images embedded at once, each making attachments/ or finding it made', async () => {
    const vault = memoryVault({});
    const named = (name: string): IncomingImage => ({ ...screenshot, name, origin: 'file' });
    const embedded = await Promise.all(
      ['a.png', 'b.png', 'c.png'].map((name) => embed(vault, { image: named(name) })),
    );
    expect(embedded.map((image) => image.path)).toEqual([
      'attachments/a.png',
      'attachments/b.png',
      'attachments/c.png',
    ]);
    expect(vault.madeFolders).toEqual(['attachments']);
  });

  it('saves many same-named images embedded at once, each under its own name', async () => {
    const vault = memoryVault({ attachments: [] });
    const photo: IncomingImage = { ...screenshot, name: 'photo.png', origin: 'file' };
    const embedded = await Promise.all(
      Array.from({ length: 6 }, () => embed(vault, { image: photo })),
    );
    expect(embedded.map((image) => image.path).sort()).toEqual([
      'attachments/photo 2.png',
      'attachments/photo 3.png',
      'attachments/photo 4.png',
      'attachments/photo 5.png',
      'attachments/photo 6.png',
      'attachments/photo.png',
    ]);
  });

  it('says so when attachments cannot be made because a file has the name', async () => {
    const vault = memoryVault({});
    vault.fs.createFolder = async () => {
      throw new Error('something with that name is already there');
    };
    await expect(embed(vault)).rejects.toThrow(
      'The folder “attachments” could not be made: something with that name is already there',
    );
  });
});

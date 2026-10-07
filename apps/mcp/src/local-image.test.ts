import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { imageFolders, readLocalImage } from './local-image.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let root: string;
let pictures: string;
let elsewhere: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-mcp-local-image-')));
  pictures = join(root, 'Pictures');
  elsewhere = join(root, 'Elsewhere');
  await mkdir(pictures);
  await mkdir(elsewhere);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The one answer every refusal gives, whatever the reason was. */
const REFUSED = /is not an image this server may read/;

const read = (file: string) => readLocalImage(file, [pictures]);

describe('readLocalImage', () => {
  it('reads an image under an image folder', async () => {
    await writeFile(join(pictures, 'shot.png'), PNG);
    expect(await read(join(pictures, 'shot.png'))).toEqual(PNG);
  });

  it('reads one in a folder inside an image folder', async () => {
    await mkdir(join(pictures, '2026'));
    await writeFile(join(pictures, '2026', 'shot.png'), PNG);
    expect(await read(join(pictures, '2026', 'shot.png'))).toEqual(PNG);
  });

  it('refuses an image outside the image folders', async () => {
    await writeFile(join(elsewhere, 'shot.png'), PNG);
    await expect(read(join(elsewhere, 'shot.png'))).rejects.toThrow(REFUSED);
  });

  it('refuses a folder that only shares an image folder’s name as its start', async () => {
    await mkdir(`${pictures}-private`);
    await writeFile(join(`${pictures}-private`, 'shot.png'), PNG);
    await expect(read(join(`${pictures}-private`, 'shot.png'))).rejects.toThrow(REFUSED);
  });

  it('follows a link before deciding: one in an image folder pointing out is refused', async () => {
    await writeFile(join(elsewhere, 'shot.png'), PNG);
    await symlink(join(elsewhere, 'shot.png'), join(pictures, 'shot.png'));
    await expect(read(join(pictures, 'shot.png'))).rejects.toThrow(REFUSED);
  });

  it('refuses a link named as an image that points at a file of another kind', async () => {
    await writeFile(join(pictures, 'settings.xml'), '<svg/>');
    await symlink(join(pictures, 'settings.xml'), join(pictures, 'chart.svg'));
    await expect(read(join(pictures, 'chart.svg'))).rejects.toThrow(REFUSED);
  });

  it.each([
    ['a file whose extension is not an image kind', 'notes.txt', PNG],
    ['a file whose bytes are not its kind', 'fake.png', Buffer.from('<svg/>')],
    ['an SVG whose root is not <svg>', 'page.svg', Buffer.from('<html><svg/></html>')],
  ])('refuses %s', async (_why, name, bytes) => {
    await writeFile(join(pictures, name), bytes);
    await expect(read(join(pictures, name))).rejects.toThrow(REFUSED);
  });

  it('gives the same answer for a file that is not there, a folder, and one outside', async () => {
    await mkdir(join(pictures, 'folder.png'));
    await writeFile(join(elsewhere, 'shot.png'), PNG);
    const answers = await Promise.all(
      [join(pictures, 'gone.png'), join(pictures, 'folder.png'), join(elsewhere, 'shot.png')].map(
        (file) => read(file).catch((error: Error) => error.message.replace(file, '<file>')),
      ),
    );
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toMatch(REFUSED);
  });

  it('refuses a relative path', async () => {
    await expect(read('shot.png')).rejects.toThrow(REFUSED);
  });

  it('refuses an image past 20 MB by its size, before reading it', async () => {
    const big = join(pictures, 'big.png');
    await writeFile(big, Buffer.concat([PNG, Buffer.alloc(20 * 1024 * 1024)]));
    await expect(read(big)).rejects.toThrow(/larger than the 20 MB/);
  });
});

describe('imageFolders', () => {
  it('reads the folders from ATLAS_MCP_IMAGE_DIRS, split as PATH is', () => {
    const env = { ATLAS_MCP_IMAGE_DIRS: ['/a', ' /b ', ''].join(delimiter) };
    expect(imageFolders(env)).toEqual(['/a', '/b']);
  });

  it('defaults to Desktop, Downloads, Pictures and the temporary folder', () => {
    const home = homedir();
    expect(imageFolders({})).toEqual([
      join(home, 'Desktop'),
      join(home, 'Downloads'),
      join(home, 'Pictures'),
      tmpdir(),
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { ARTIFACT_CSP, createVaultPath } from '@atlas/domain';
import { apiFixture, TODAY } from '../testing/api-fixture.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { addArtifactCopy, ArtifactRefusedError } from './artifact-copy.ts';
import { loadArtifactCopy } from './load-artifact-copy.ts';
import { saveArtifact } from './save-artifact.ts';

const text = (value: string) => new TextEncoder().encode(value);
const file = (name: string, value: string | Uint8Array) => ({
  name,
  bytes: typeof value === 'string' ? text(value) : value,
});
const PNG = new Uint8Array([137, 80, 78, 71]);

function vault(files: Record<string, string> = {}) {
  const api = apiFixture({ files });
  const { markdown, clock } = api.deps;
  const { fs } = api;
  return { api, fs, markdown, clock };
}

describe('saveArtifact', () => {
  it('makes artifacts/ when the vault has none, then the copy, then the note', async () => {
    const { api, ...ports } = vault();

    const saved = await saveArtifact({
      ...ports,
      artifact: {
        title: 'Launch Plan',
        files: [
          file(
            'site/Launch.html',
            '<link rel="stylesheet" href="css/a.css"><img src="img/hero.png">',
          ),
          file('site/css/a.css', 'body{}'),
          file('site/img/hero.png', PNG),
          file('site/.DS_Store', 'junk'),
        ],
      },
    });

    expect(saved).toEqual({
      path: 'artifacts/Launch Plan.md',
      saved: 'artifacts/launch-plan',
      skipped: [{ name: '.DS_Store', reason: 'a file cannot be hidden' }],
    });
    expect([...api.folders]).toEqual([
      'artifacts',
      'artifacts/launch-plan',
      'artifacts/launch-plan/css',
      'artifacts/launch-plan/img',
    ]);
    expect([...api.binaries.keys()]).toEqual([
      'artifacts/launch-plan/index.html',
      'artifacts/launch-plan/css/a.css',
      'artifacts/launch-plan/img/hero.png',
    ]);
    const note = api.files.get('artifacts/Launch Plan.md')?.text ?? '';
    expect(note).toContain('type: artifact');
    expect(note).toContain('kind: page');
    expect(note).toContain(`saved_at: ${TODAY}`);
    // The cover is the thumbnail's, made once the copy is on disk; never a picture of the page's.
    expect(note).not.toContain('cover:');
  });

  it('guesses the kind from the page it saves', async () => {
    const { api, ...ports } = vault();
    await saveArtifact({
      ...ports,
      artifact: { title: 'D', files: [file('index.html', '<article><p>x</p></article>')] },
    });
    expect(api.files.get('artifacts/D.md')?.text).toContain('kind: doc');
  });

  it('refuses files with no page to open, writing nothing', async () => {
    const { api, ...ports } = vault();
    await expect(
      saveArtifact({ ...ports, artifact: { title: 'X', files: [file('a.css', '')] } }),
    ).rejects.toThrow(ArtifactRefusedError);
    expect(api.folders.size).toBe(0);
    expect(api.writes).toEqual([]);
  });

  it('refuses when artifacts is a file', async () => {
    const { api, ...ports } = vault();
    api.binaries.set('artifacts', new Uint8Array());
    await expect(saveArtifact({ ...ports, artifact: { title: 'X' } })).rejects.toThrow(
      /artifacts is a file/,
    );
  });
});

describe('addArtifactCopy', () => {
  it('writes the copy beside the note, named for it, and says what to record', async () => {
    const { api, fs, clock } = vault({ 'artifacts/My Page.md': '---\ntype: artifact\n---\n' });

    const added = await addArtifactCopy({
      fs,
      notePath: createVaultPath('artifacts/My Page.md'),
      files: [file('page.html', '<p>hi</p>'), file('logo.webp', PNG)],
      today: clock.today(),
    });

    expect(added).toEqual({
      copy: { saved: 'artifacts/my-page', savedAt: TODAY },
      skipped: [],
    });
    expect(api.binaries.has('artifacts/my-page/index.html')).toBe(true);
  });

  it('refuses when something already has the copy folder’s name, and when there is no page', async () => {
    const { api, fs } = vault({ 'artifacts/My Page.md': '' });
    api.folders.add('artifacts/my-page');
    const notePath = createVaultPath('artifacts/My Page.md');
    await expect(
      addArtifactCopy({ fs, notePath, files: [file('index.html', '')], today: TODAY }),
    ).rejects.toThrow(/already beside this note/);
    await expect(
      addArtifactCopy({ fs, notePath, files: [file('a.png', PNG)], today: TODAY }),
    ).rejects.toThrow(ArtifactRefusedError);
  });
});

describe('loadArtifactCopy', () => {
  async function saved(files: ReturnType<typeof file>[]) {
    const { api, ...ports } = vault();
    await saveArtifact({ ...ports, artifact: { title: 'P', files } });
    return api;
  }

  it('is none when the note keeps only the link', async () => {
    const { fs } = vault();
    expect(await loadArtifactCopy({ fs, properties: { type: 'artifact' } })).toEqual({
      kind: 'none',
    });
  });

  it('writes what the page names into it, under the policy', async () => {
    const api = await saved([
      file(
        'index.html',
        '<html><head><link rel="stylesheet" href="a.css"></head><img src="i.png"></html>',
      ),
      file('a.css', '.x{background:url(bg.png)}'),
      file('bg.png', new Uint8Array([1])),
      file('i.png', new Uint8Array([2])),
    ]);

    const copy = await loadArtifactCopy({
      fs: api.fs,
      properties: { saved: 'artifacts/p' },
    });

    expect(copy.kind).toBe('ready');
    const page = copy.kind === 'ready' ? copy.page : '';
    expect(page).toContain(`content="${ARTIFACT_CSP}"`);
    expect(page).toContain('<style>.x{background:url(data:image/png;base64,AQ==)}</style>');
    expect(page).toContain('<img src="data:image/png;base64,Ag==">');
  });

  it('opens on the only page when there is no index.html', async () => {
    const api = await saved([file('index.html', 'x')]);
    api.binaries.set('artifacts/p/other.html', text('<p>other</p>'));
    api.binaries.delete('artifacts/p/index.html');
    const copy = await loadArtifactCopy({ fs: api.fs, properties: { saved: 'artifacts/p' } });
    expect(copy.kind === 'ready' && copy.page.endsWith('<p>other</p>')).toBe(true);
  });

  it.each([
    ['a folder that is gone', 'artifacts/gone'],
    ['a folder in .atlas', '.atlas/types'],
    ['a hidden folder', 'x/.secret'],
    ['a path that escapes the vault', '../outside'],
  ])('is missing for %s', async (_why, folder) => {
    const { fs } = vault();
    expect((await loadArtifactCopy({ fs, properties: { saved: folder } })).kind).toBe('missing');
  });

  it('is missing when the copy holds no page', async () => {
    const api = await saved([file('index.html', 'x'), file('a.png', PNG)]);
    api.binaries.delete('artifacts/p/index.html');
    expect(
      (await loadArtifactCopy({ fs: api.fs, properties: { saved: 'artifacts/p' } })).kind,
    ).toBe('missing');
  });

  it('writes in scripts, reads each file once, and shows the page without a file that will not read', async () => {
    const api = await saved([
      file(
        'index.html',
        '<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css">' +
          '<script src="app.js"></script><img src="gone.png">',
      ),
      file('a.css', '.a{background:url(shared.png)} .z{background:url(nowhere.png)}'),
      file('b.css', '.b{background:url(shared.png)}'),
      file('shared.png', new Uint8Array([7])),
      file('app.js', 'run()'),
      file('gone.png', PNG),
    ]);
    const reads: string[] = [];
    const fs = {
      ...api.fs,
      readBinaryFile: async (path: Parameters<typeof api.fs.readBinaryFile>[0]) => {
        reads.push(path);
        if (path.endsWith('gone.png')) throw new VaultAccessError('no such entry');
        return api.fs.readBinaryFile(path);
      },
    };

    const copy = await loadArtifactCopy({ fs, properties: { saved: 'artifacts/p' } });

    const page = copy.kind === 'ready' ? copy.page : '';
    expect(page).toContain('<script>run()</script>');
    expect(page).toContain('.b{background:url(data:image/png;base64,Bw==)}');
    expect(page).toContain('<img src="gone.png">');
    expect(reads.filter((path) => path.endsWith('shared.png'))).toHaveLength(1);
  });

  it('lets a failure that is not the vault refusing go on as it is', async () => {
    const api = await saved([file('index.html', '<img src="i.png">'), file('i.png', PNG)]);
    const broken = {
      ...api.fs,
      readBinaryFile: async () => Promise.reject(new TypeError('bug')),
    };
    await expect(
      loadArtifactCopy({ fs: broken, properties: { saved: 'artifacts/p' } }),
    ).rejects.toThrow('bug');
    const listing = {
      ...api.fs,
      listDirectory: async () => Promise.reject(new TypeError('odd')),
    };
    await expect(
      loadArtifactCopy({ fs: listing, properties: { saved: 'artifacts/p' } }),
    ).rejects.toThrow('odd');
  });
});

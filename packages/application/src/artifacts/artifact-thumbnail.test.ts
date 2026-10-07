import { describe, expect, it, vi } from 'vitest';
import { ARTIFACT_CSP, createVaultPath, MAX_THUMBNAIL_BYTES, THUMBNAIL_SHOT } from '@atlas/domain';
import { setNoteProperties, type PropertyChanges } from '../query/set-property.ts';
import { apiFixture } from '../testing/api-fixture.ts';
import { ArtifactRefusedError } from './artifact-copy.ts';
import { artifactsWithoutThumbnails, generateArtifactThumbnail } from './artifact-thumbnail.ts';
import type { PageSnapshotPort } from './ports.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const NOTE_PATH = createVaultPath('artifacts/Launch Plan.md');
const THUMBNAIL = 'artifacts/launch-plan/atlas-thumbnail.png';

const note = (extra = '') =>
  `---\ntype: artifact\nsaved: artifacts/launch-plan\n${extra}---\n\nNotes.\n`;

/** A vault holding the note and its copy, and a snapshot that answers `picture`. */
function setUp({
  text = note(),
  picture = async () => PNG,
}: {
  text?: string;
  picture?: PageSnapshotPort['capture'];
} = {}) {
  const api = apiFixture({ files: { [NOTE_PATH]: text } });
  api.folders.add('artifacts');
  api.folders.add('artifacts/launch-plan');
  api.binaries.set(
    'artifacts/launch-plan/index.html',
    new TextEncoder().encode('<h1>Launch</h1><script>draw()</script>'),
  );
  const { markdown } = api.deps;
  const { fs } = api;
  const snapshot = { capture: vi.fn(picture) };
  const setProperties = vi.fn((values: PropertyChanges) =>
    setNoteProperties({ fs, markdown, path: NOTE_PATH, values }),
  );
  const generate = (asked = false) =>
    generateArtifactThumbnail({
      fs,
      markdown,
      snapshot,
      notePath: NOTE_PATH,
      asked,
      setProperties,
    });
  const noteText = () => api.files.get(NOTE_PATH)?.text ?? '';
  return { api, snapshot, setProperties, generate, noteText };
}

describe('generateArtifactThumbnail', () => {
  it('pictures the copy under its policy, keeps the PNG in the copy, and makes it the cover', async () => {
    const { api, snapshot, generate, noteText } = setUp();

    const result = await generate();

    expect(result).toEqual({
      kind: 'made',
      path: THUMBNAIL,
      cover: 'launch-plan/atlas-thumbnail.png',
    });
    const asked = snapshot.capture.mock.calls[0]?.[0];
    expect(asked).toMatchObject(THUMBNAIL_SHOT);
    // The same inlined, policy-first page the viewer's frame is given.
    expect(asked?.html.indexOf(ARTIFACT_CSP)).toBeGreaterThan(-1);
    expect(asked?.html.indexOf(ARTIFACT_CSP)).toBeLessThan(asked?.html.indexOf('<h1>') ?? 0);
    expect(api.binaries.get(THUMBNAIL)).toEqual(PNG);
    expect(noteText()).toContain('cover: launch-plan/atlas-thumbnail.png');
    expect(noteText()).toContain('Notes.');
  });

  it('makes it again over the one it made before, leaving the note as it was', async () => {
    const { api, generate, noteText, snapshot } = setUp({
      text: note('cover: launch-plan/atlas-thumbnail.png\n'),
    });
    api.binaries.set(THUMBNAIL, new Uint8Array([0x89, 0x50]));
    const before = noteText();
    snapshot.capture.mockResolvedValueOnce(PNG);

    await expect(generate()).resolves.toMatchObject({ kind: 'made' });

    expect(api.binaries.get(THUMBNAIL)).toEqual(PNG);
    expect(noteText()).toBe(before);
  });

  it('leaves a cover set by hand alone, picturing nothing, unless asked', async () => {
    const { api, snapshot, generate, noteText } = setUp({ text: note('cover: photos/me.jpg\n') });

    await expect(generate()).resolves.toEqual({ kind: 'kept' });
    expect(snapshot.capture).not.toHaveBeenCalled();
    expect(api.binaries.has(THUMBNAIL)).toBe(false);
    expect(noteText()).toContain('cover: photos/me.jpg');

    await expect(generate(true)).resolves.toMatchObject({ kind: 'made' });
    expect(noteText()).toContain('cover: launch-plan/atlas-thumbnail.png');
  });

  it('keeps a cover set by hand while the picture was being made', async () => {
    const { api, generate, noteText } = setUp({
      picture: async () => {
        // The person sets a cover while the host is still picturing the page.
        const text = api.files.get(NOTE_PATH)?.text ?? '';
        await api.fs.writeTextFile({
          path: NOTE_PATH,
          contents: text.replace('saved:', 'cover: photos/me.jpg\nsaved:'),
          expectedModified: null,
        });
        return PNG;
      },
    });

    await generate();

    expect(noteText()).toContain('cover: photos/me.jpg');
    expect(noteText()).not.toContain('atlas-thumbnail');
  });

  it('leaves the cover untouched when the picture cannot be made', async () => {
    const { api, generate, noteText, setProperties } = setUp({
      picture: async () => {
        throw new Error('thumbnails are made on macOS only');
      },
    });
    const before = noteText();

    await expect(generate()).rejects.toThrow('thumbnails are made on macOS only');

    expect(noteText()).toBe(before);
    expect(setProperties).not.toHaveBeenCalled();
    expect(api.binaries.has(THUMBNAIL)).toBe(false);
  });

  it('refuses a picture that is not a PNG, or too big, writing nothing', async () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)">');
    const huge = new Uint8Array(MAX_THUMBNAIL_BYTES + 1);
    huge.set(PNG);
    for (const bytes of [svg, huge]) {
      const { api, generate, noteText } = setUp({ picture: async () => bytes });
      const before = noteText();
      await expect(generate()).rejects.toThrow(ArtifactRefusedError);
      expect(api.binaries.has(THUMBNAIL)).toBe(false);
      expect(noteText()).toBe(before);
    }
  });

  it('refuses a note with no copy to picture', async () => {
    const { generate, snapshot } = setUp({ text: '---\ntype: artifact\n---\n' });
    await expect(generate()).rejects.toThrow('There is no saved copy to picture');
    expect(snapshot.capture).not.toHaveBeenCalled();
  });

  it('never writes into a folder that is not the note’s copy', async () => {
    const { api, generate, snapshot } = setUp({ text: note().replace('launch-plan', 'Tasks') });
    api.folders.add('artifacts/Tasks');
    api.binaries.set('artifacts/Tasks/index.html', new TextEncoder().encode('<p>'));
    api.files.set('artifacts/Tasks/Call mum.md', { text: '', modified: 1 });

    await expect(generate(true)).rejects.toThrow(/holds notes/);
    expect(snapshot.capture).not.toHaveBeenCalled();
    expect(api.binaries.has('artifacts/Tasks/atlas-thumbnail.png')).toBe(false);
  });
});

describe('artifactsWithoutThumbnails', () => {
  it('is the artifacts with a copy and no cover, passing over notes that will not read', async () => {
    const api = apiFixture({
      files: {
        'artifacts/A.md': '---\ntype: artifact\nsaved: artifacts/a\n---\n',
        'artifacts/B.md': '---\ntype: artifact\nsaved: artifacts/b\ncover: b/x.png\n---\n',
        'artifacts/C.md': '---\ntype: artifact\n---\n',
      },
      index: {
        notesOfType: async (type) =>
          type === 'artifact'
            ? ['A', 'B', 'C', 'Gone'].map((name) => ({
                path: `artifacts/${name}.md`,
                title: name,
              }))
            : [],
      },
    });
    const { index, markdown } = api.deps;
    const { fs } = api;

    await expect(artifactsWithoutThumbnails({ index, fs, markdown })).resolves.toEqual([
      'artifacts/A.md',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { artifactCopyPlan, artifactFileRefusal } from './artifact-files.ts';
import {
  ARTIFACT_THUMBNAIL,
  MAX_THUMBNAIL_BYTES,
  THUMBNAIL_SHOT,
  clearedCover,
  coverIsAtlas,
  isThumbnailName,
  needsThumbnail,
  thumbnailCover,
  thumbnailCoverChange,
  thumbnailPath,
  thumbnailRefusal,
} from './artifact-thumbnail.ts';

const FOLDER = createVaultPath('artifacts/launch-plan');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('where a thumbnail goes', () => {
  it('is atlas-thumbnail.png at the top of the copy, and the cover names it from the note', () => {
    expect(thumbnailPath(FOLDER)).toBe('artifacts/launch-plan/atlas-thumbnail.png');
    expect(thumbnailCover(FOLDER)).toBe('launch-plan/atlas-thumbnail.png');
  });

  it('is pictured 16:10, at half the screen it is laid out on', () => {
    const { width, height, pictureWidth } = THUMBNAIL_SHOT;
    expect(width / height).toBe(16 / 10);
    expect(pictureWidth * 2).toBe(width);
  });
});

describe('the name is kept for Atlas', () => {
  it('is refused as a file of the copy, in any case, and only at the top', () => {
    expect(isThumbnailName('Atlas-Thumbnail.PNG')).toBe(true);
    expect(artifactFileRefusal(ARTIFACT_THUMBNAIL)).toBe(
      'atlas-thumbnail.png is kept for the thumbnail Atlas makes',
    );
    expect(artifactFileRefusal('ATLAS-THUMBNAIL.png')).not.toBeNull();
    expect(artifactFileRefusal('img/atlas-thumbnail.png')).toBeNull();
    expect(artifactFileRefusal('thumbnail.png')).toBeNull();
  });

  it('is skipped, and said why, when a dropped copy brings one', () => {
    const bytes = new Uint8Array([1]);
    const plan = artifactCopyPlan([
      { name: 'index.html', bytes },
      { name: 'atlas-thumbnail.png', bytes },
    ]);
    expect(plan?.files.map((file) => file.name)).toEqual(['index.html']);
    expect(plan?.skipped).toEqual([
      {
        name: 'atlas-thumbnail.png',
        reason: 'atlas-thumbnail.png is kept for the thumbnail Atlas makes',
      },
    ]);
  });
});

describe('whose cover it is', () => {
  it("is Atlas's when empty, or naming this copy's thumbnail either way it resolves", () => {
    for (const cover of [undefined, null, '', '  ', 'launch-plan/atlas-thumbnail.png']) {
      expect(coverIsAtlas({ properties: { cover }, folder: FOLDER }), String(cover)).toBe(true);
    }
    expect(
      coverIsAtlas({ properties: { cover: './launch-plan/atlas-thumbnail.png' }, folder: FOLDER }),
    ).toBe(true);
    expect(
      coverIsAtlas({
        properties: { cover: 'artifacts/launch-plan/atlas-thumbnail.png' },
        folder: FOLDER,
      }),
    ).toBe(true);
  });

  it("is the person's when it names anything else — even another copy's thumbnail", () => {
    for (const cover of [
      'launch-plan/hero.png',
      'photos/me.jpg',
      'https://example.com/a.png',
      'other/atlas-thumbnail.png',
    ]) {
      expect(coverIsAtlas({ properties: { cover }, folder: FOLDER }), cover).toBe(false);
    }
  });
});

describe('setting the cover once the thumbnail is on disk', () => {
  const auto = thumbnailCoverChange({ folder: FOLDER, asked: false });
  const asked = thumbnailCoverChange({ folder: FOLDER, asked: true });

  it('sets an empty cover to the thumbnail', () => {
    expect(auto({})).toEqual({ cover: 'launch-plan/atlas-thumbnail.png' });
    expect(auto({ cover: '' })).toEqual({ cover: 'launch-plan/atlas-thumbnail.png' });
  });

  it('writes nothing when the cover already names it', () => {
    expect(auto({ cover: 'launch-plan/atlas-thumbnail.png' })).toEqual({});
    expect(asked({ cover: 'launch-plan/atlas-thumbnail.png' })).toEqual({});
  });

  it('rewrites a vault-rooted form of it as the note-relative one', () => {
    expect(auto({ cover: 'artifacts/launch-plan/atlas-thumbnail.png' })).toEqual({
      cover: 'launch-plan/atlas-thumbnail.png',
    });
  });

  it('never overwrites a cover set by hand, unless the person asked', () => {
    expect(auto({ cover: 'photos/me.jpg' })).toEqual({});
    expect(asked({ cover: 'photos/me.jpg' })).toEqual({ cover: 'launch-plan/atlas-thumbnail.png' });
  });
});

describe('which artifacts need one', () => {
  const artifact = { type: 'artifact', saved: 'artifacts/launch-plan' };

  it('is an artifact with a copy and no cover', () => {
    expect(needsThumbnail(artifact)).toBe(true);
    expect(needsThumbnail({ ...artifact, cover: ' ' })).toBe(true);
  });

  it('reads its cover as any thumbnail is read: `auto` wants one, "false" is cleared', () => {
    expect(needsThumbnail({ ...artifact, cover: 'AUTO' })).toBe(true);
    expect(needsThumbnail({ ...artifact, cover: 'false' })).toBe(false);
    expect(coverIsAtlas({ properties: { cover: 'auto' }, folder: FOLDER })).toBe(true);
    expect(coverIsAtlas({ properties: { cover: 'false' }, folder: FOLDER })).toBe(false);
    const auto = thumbnailCoverChange({ folder: FOLDER, asked: false });
    expect(auto({ cover: 'auto' })).toEqual({ cover: 'launch-plan/atlas-thumbnail.png' });
    expect(auto({ cover: 'false' })).toEqual({});
  });

  it('is not one with a cover, one with only its link, or another kind of note', () => {
    expect(needsThumbnail({ ...artifact, cover: 'launch-plan/atlas-thumbnail.png' })).toBe(false);
    expect(needsThumbnail({ ...artifact, cover: 'photos/me.jpg' })).toBe(false);
    expect(needsThumbnail({ type: 'artifact' })).toBe(false);
    expect(needsThumbnail({ ...artifact, saved: '' })).toBe(false);
    expect(needsThumbnail({ ...artifact, type: 'task' })).toBe(false);
  });
});

describe('a thumbnail cleared on purpose', () => {
  const cleared = { type: 'artifact', saved: 'artifacts/launch-plan', ...clearedCover() };

  it('is written as a cover of false: no picture, and not an empty one', () => {
    expect(clearedCover()).toEqual({ cover: false });
  });

  it('is not given one again without being asked, however it is asked for', () => {
    expect(needsThumbnail(cleared)).toBe(false);
    expect(coverIsAtlas({ properties: cleared, folder: FOLDER })).toBe(false);
    expect(thumbnailCoverChange({ folder: FOLDER, asked: false })(cleared)).toEqual({});
  });

  it('is given one again when the person asks (Regenerate)', () => {
    expect(thumbnailCoverChange({ folder: FOLDER, asked: true })(cleared)).toEqual({
      cover: 'launch-plan/atlas-thumbnail.png',
    });
  });
});

describe('what is kept as a thumbnail', () => {
  it('is a PNG no bigger than the cap', () => {
    expect(thumbnailRefusal(PNG)).toBeNull();
    const atCap = new Uint8Array(MAX_THUMBNAIL_BYTES);
    atCap.set(PNG);
    expect(thumbnailRefusal(atCap)).toBeNull();
  });

  it('refuses anything bigger, anything else, and nothing at all', () => {
    const over = new Uint8Array(MAX_THUMBNAIL_BYTES + 1);
    over.set(PNG);
    expect(thumbnailRefusal(over)).toBe('a thumbnail is at most 4 MB');
    expect(thumbnailRefusal(new TextEncoder().encode('<svg onload=alert(1)>'))).toBe(
      'the thumbnail is not a PNG picture',
    );
    expect(thumbnailRefusal(PNG.slice(0, 8))).not.toBeNull();
    expect(thumbnailRefusal(new Uint8Array())).not.toBeNull();
    const oneByteOff = PNG.slice();
    oneByteOff[7] = 0;
    expect(thumbnailRefusal(oneByteOff)).not.toBeNull();
  });
});
